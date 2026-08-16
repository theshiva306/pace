import { useEffect, useState } from 'react'
import { ref, onValue } from 'firebase/database'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'

// Subscribes to the current user's single active session. This is the
// refresh-safe source of truth for the Timer screen.
export function useActiveSession() {
  const { user } = useAuth()
  const [session, setSession] = useState(undefined) // undefined = loading

  useEffect(() => {
    if (!user) return
    const sessRef = ref(db, `activeSessions/${user.uid}`)
    const unsub = onValue(sessRef, (snap) => setSession(snap.exists() ? snap.val() : null))
    return unsub
  }, [user])

  return session
}
