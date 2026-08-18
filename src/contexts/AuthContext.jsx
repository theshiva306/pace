import { createContext, useContext, useEffect, useState } from 'react'
import {
  onAuthStateChanged, signInWithPopup, signInWithRedirect, getRedirectResult, signOut,
} from 'firebase/auth'
import { ref, onValue, set, serverTimestamp, get } from 'firebase/database'
import { auth, db, googleProvider } from '../firebase'
import { ensureUserStats } from '../lib/userStats'

const AuthContext = createContext(null)

// True popup *windows* don't really exist on mobile browsers — what looks
// like "a new tab opened instead of a popup" on a phone is the browser
// itself substituting a full-page context for the popup, not a bug in
// how we call the API. Detecting that up front and using a redirect flow
// there instead gives mobile users a single continuous full-page hop that
// returns automatically, rather than a stray tab they have to notice and
// switch back from.
const PREFERS_REDIRECT = typeof navigator !== 'undefined'
  && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

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

  useEffect(() => {
    if (!user) return
    const userRef = ref(db, `users/${user.uid}`)
    const unsub = onValue(userRef, (snap) => setProfile(snap.val()))
    return unsub
  }, [user])

  useEffect(() => {
    if (!user) return
    const groupsRef = ref(db, `userGroups/${user.uid}`)
    const unsub = onValue(groupsRef, (snap) => {
      setGroupIds(snap.exists() ? Object.keys(snap.val()) : [])
      setGroupsLoaded(true)
    })
    return unsub
  }, [user])

  async function login() {
    setAuthError(null)
    if (PREFERS_REDIRECT) {
      return signInWithRedirect(auth, googleProvider)
    }
    try {
      await signInWithPopup(auth, googleProvider)
    } catch (err) {
      // Popup blocked or closed by the OS/browser chrome (common on
      // desktop Safari with strict popup settings) — fall back to a
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
