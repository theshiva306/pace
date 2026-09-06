import { createContext, useContext, useEffect, useState } from 'react'
import {
  onAuthStateChanged, signInWithPopup, signInWithRedirect, getRedirectResult, signOut,
} from 'firebase/auth'
import { ref, onValue, set, serverTimestamp, get } from 'firebase/database'
import { auth, db, databaseURL, googleProvider } from '../firebase'
import { ensureUserStats } from '../lib/userStats'
import { saveAuthCache } from '../lib/tokenCache'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined) // undefined = loading, null = signed out
  const [profile, setProfile] = useState(null)
  const [groupIds, setGroupIds] = useState([])
  const [groupsLoaded, setGroupsLoaded] = useState(false)
  const [authError, setAuthError] = useState(null)

  useEffect(() => {
    // Picks up the result of a signInWithRedirect() round-trip, if one is
    // in flight. No-op (resolves to null) on a normal load.
    getRedirectResult(auth).catch((err) => {
      console.error('Google sign-in failed:', err)
      setAuthError(err?.code === 'auth/network-request-failed'
        ? 'No internet connection. Please try again.'
        : 'Sign-in failed. Please try again.')
    })
  }, [])

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        setUser(null)
        setProfile(null)
        setGroupIds([])
        setGroupsLoaded(false)
        return
      }
      setUser(fbUser)
      const userRef = ref(db, `users/${fbUser.uid}`)
      const snap = await get(userRef)
      if (!snap.exists()) {
        await set(userRef, {
          uid: fbUser.uid,
          displayName: fbUser.displayName || 'Student',
          photoURL: fbUser.photoURL || null,
          createdAt: serverTimestamp(),
        })
      }
      // Backfill the user-owned source of truth from existing completed
      // sessions. This is what makes old history survive group deletion.
      try { await ensureUserStats(fbUser.uid) } catch (err) { console.error('Unable to backfill study stats', err) }
    })
    return unsub
  }, [])

  const uid = user?.uid

  // Keeps a reasonably fresh ID token in IndexedDB, so a Pause/Resume tap
  // on the persistent session notification can still authenticate a
  // direct database write even if the site has been fully closed — see
  // lib/tokenCache.js for the full explanation and its known limitation
  // (a token cached here still expires roughly hourly; this just makes
  // sure there's usually a recent one available for that fallback).
  useEffect(() => {
    if (!user) return undefined
    const refresh = () => {
      user.getIdToken().then((token) => {
        saveAuthCache({ uid: user.uid, token, databaseURL })
      }).catch(() => {
        // Offline, or the session itself is no longer valid — nothing to
        // do here; the next successful refresh (or the next login)
        // updates the cache as normal.
      })
    }
    refresh()
    const id = window.setInterval(refresh, 30 * 60 * 1000) // every 30 min
    return () => window.clearInterval(id)
    // Keyed on uid, not `user` — calling .getIdToken() on an "older" User
    // object reference still correctly returns a freshly refreshed token
    // regardless of which snapshot it's called from (the method proxies
    // to the SDK's current internal auth state), so there's no need to
    // tear down and restart this interval just because `user`'s object
    // identity changed on a token refresh — same reasoning as the other
    // uid-keyed effects in this file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid])

  useEffect(() => {
    if (!uid) return
    const userRef = ref(db, `users/${uid}`)
    const unsub = onValue(userRef, (snap) => setProfile(snap.val()))
    return unsub
    // Keyed on uid, not `user` — see the matching comment in
    // useActiveSession.js for why the object itself isn't safe to depend
    // on here (Firebase re-emits a new User reference on every token
    // refresh, which would otherwise tear this down and rebuild it hourly
    // for no reason).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid])

  useEffect(() => {
    if (!uid) return
    const groupsRef = ref(db, `userGroups/${uid}`)
    const unsub = onValue(groupsRef, (snap) => {
      setGroupIds(snap.exists() ? Object.keys(snap.val()) : [])
      setGroupsLoaded(true)
    })
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid])

  async function login() {
    setAuthError(null)
    try {
      // Popup works on both desktop and modern mobile browsers, and avoids
      // the redirect flow's dependency on temporary storage surviving a
      // full-page trip through Google — storage that phone browsers
      // (Safari ITP, Chrome storage partitioning, etc.) increasingly block,
      // which is what caused sign-in to silently fail on phones before.
      await signInWithPopup(auth, googleProvider)
    } catch (err) {
      // Popup blocked or unsupported in this environment — fall back to a
      // redirect rather than leaving the person stuck.
      if (err?.code === 'auth/popup-blocked' || err?.code === 'auth/operation-not-supported-in-this-environment') {
        return signInWithRedirect(auth, googleProvider)
      }
      if (err?.code !== 'auth/cancelled-popup-request' && err?.code !== 'auth/popup-closed-by-user') {
        console.error('Google sign-in failed:', err)
        setAuthError('Sign-in failed. Please try again.')
      }
    }
  }
  const logout = () => signOut(auth)

  return (
    <AuthContext.Provider value={{ user, profile, groupIds, groupsLoaded, login, logout, authError, clearAuthError: () => setAuthError(null) }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
