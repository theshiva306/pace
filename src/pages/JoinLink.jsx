import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { joinGroupByLink } from '../lib/sessions'
import { AppSplashSkeleton } from '../components/Skeleton'
import GoogleButton from '../components/GoogleButton'

// Landing page for an invite link: /#/join/<groupId>
// Handles both signed-out and signed-in visitors. No invite-code system is used.
export default function JoinLink() {
  const { groupId } = useParams()
  const { user, profile, login, authError } = useAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user || !profile || status !== 'idle') return
    setStatus('joining')
    joinGroupByLink({
      uid: user.uid,
      displayName: profile.displayName,
      photoURL: profile.photoURL,
      groupId,
    })
      .then((res) => {
        if (res.error === 'invalid') { setError('Invalid invite link'); setStatus('error'); return }
        if (res.error === 'full') { setError('Group full'); setStatus('error'); return }
        navigate(`/groups/${res.groupId}`, { replace: true })
      })
      .catch((err) => {
        console.error('joinGroupByLink failed:', err)
        setError(err?.message || 'Something went wrong')
        setStatus('error')
      })
  }, [user, profile, status, groupId, navigate])

  if (user === undefined) {
    return <AppSplashSkeleton />
  }

  if (user === null) {
    return (
      <div className="min-h-svh flex flex-col items-center justify-center px-8 text-center gap-8">
        <div>
          <div className="text-[13px] tracking-[0.3em] text-text-faint mb-3">YOU'RE INVITED</div>
          <h1 className="font-display text-3xl font-semibold">Join the group</h1>
        </div>
        <GoogleButton onClick={login} />
        {authError && <p className="text-xs text-danger">{authError}</p>}
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
    <AppSplashSkeleton>
      <p className="text-xs text-text-faint animate-fade-in">Joining the group…</p>
    </AppSplashSkeleton>
  )
}
