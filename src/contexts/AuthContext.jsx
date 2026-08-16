import { createContext, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'
import { ref, onValue, set, serverTimestamp, get } from 'firebase/database'
import { auth, db, googleProvider } from '../firebase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined) // undefined = loading, null = signed out
  const [profile, setProfile] = useState(null)
  const [groupIds, setGroupIds] = useState([])

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        setUser(null)
        setProfile(null)
        setGroupIds([])
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
    })
    return unsub
  }, [user])

  const login = () => signInWithPopup(auth, googleProvider)
  const logout = () => signOut(auth)

  return (
    <AuthContext.Provider value={{ user, profile, groupIds, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
