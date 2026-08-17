import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { joinGroupByCode } from '../lib/sessions'

// Landing page for an invite link: /#/join/ABC123
// Handles both "not signed in yet" and "already signed in" — either way,
// the person ends up a member of the group with no code to type.
export default function JoinLink() {
  const { code } = useParams()
  const { user, profile, login } = useAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState('idle') // idle | joining | error
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user || !profile || status !== 'idle') return
    setStatus('joining')
    joinGroupByCode({
      uid: user.uid,
      displayName: profile.displayName,
      photoURL: profile.photoURL,
      code,
    })
      .then((res) => {
        if (res.error === 'invalid') { setError('Invalid invite link'); setStatus('error'); return }
        if (res.error === 'full') { setError('Group full'); setStatus('error'); return }
        navigate(`/groups/${res.groupId}`, { replace: true })
      })
      .catch((err) => {
        console.error('joinGroupByCode failed:', err)
        setError(err?.message || 'Something went wrong')
        setStatus('error')
      })
  }, [user, profile, status, code, navigate])

  if (user === undefined) {
    return (
      <div className="min-h-svh flex items-center justify-center">
        <div className="w-2 h-2 rounded-full bg-accent animate-breathe" />
      </div>
    )
  }

  if (user === null) {
    return (
      <div className="min-h-svh flex flex-col items-center justify-center px-8 text-center gap-8">
        <div>
          <div className="text-[13px] tracking-[0.3em] text-text-faint mb-3">YOU'RE INVITED</div>
          <h1 className="font-display text-3xl font-semibold">Join the group</h1>
        </div>
        <button
          onClick={login}
          className="flex items-center gap-3 bg-elevated border border-border hover:border-text-faint rounded-xl px-6 py-3.5 transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 01-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.98v2.33A9 9 0 009 18z"/>
            <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 013.68 9c0-.59.1-1.16.27-1.7V4.97H.98A9 9 0 000 9c0 1.45.35 2.83.98 4.03l2.97-2.33z"/>
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 00.98 4.97l2.97 2.33C4.66 5.17 6.65 3.58 9 3.58z"/>
          </svg>
          <span className="text-sm font-medium">Continue with Google</span>
        </button>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="min-h-svh flex flex-col items-center justify-center px-8 text-center gap-5">
        <p className="text-danger text-sm">{error}</p>
        <button onClick={() => navigate('/')} className="text-sm text-accent font-medium">
          Go to app
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-svh flex items-center justify-center">
      <div className="w-2 h-2 rounded-full bg-accent animate-breathe" />
    </div>
  )
}
