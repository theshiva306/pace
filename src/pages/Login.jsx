import { useAuth } from '../contexts/AuthContext'
import GoogleButton from '../components/GoogleButton'
import { LogoMark } from '../components/Logo'
import { TimerIcon, GroupsIcon, LeagueIcon } from '../components/icons'

const FEATURES = [
  { icon: TimerIcon, label: 'Focus timer' },
  { icon: GroupsIcon, label: 'Study groups' },
  { icon: LeagueIcon, label: 'Leaderboards' },
]

export default function Login() {
  const { login, authError } = useAuth()
  return (
    <div className="relative min-h-svh overflow-hidden flex flex-col items-center justify-center px-8 text-center">
      {/* Aurora background — two soft drifting gradient blobs behind a
          radial vignette, purely decorative, no external image assets. */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute -top-1/4 -left-1/4 w-[70vw] h-[70vw] rounded-full animate-aurora-1"
          style={{ background: 'radial-gradient(circle, rgba(212,162,76,0.16) 0%, transparent 70%)' }}
        />
        <div
          className="absolute -bottom-1/4 -right-1/4 w-[70vw] h-[70vw] rounded-full animate-aurora-2"
          style={{ background: 'radial-gradient(circle, rgba(62,207,142,0.12) 0%, transparent 70%)' }}
        />
        <div
          className="absolute inset-0"
          style={{ background: 'radial-gradient(circle at 50% 40%, transparent 0%, var(--color-bg) 78%)' }}
        />
      </div>

      <div className="relative z-10 flex flex-col items-center">
        <div className="mb-3 animate-rise">
          <div className="w-16 h-16 rounded-2xl bg-elevated border border-border flex items-center justify-center">
            <LogoMark size={30} spinning />
          </div>
        </div>

        <div className="mb-3 animate-rise" style={{ animationDelay: '40ms' }}>
          <div className="text-[13px] tracking-[0.3em] text-text-faint mb-3">STUDY · COMPETE</div>
          <h1 className="font-display text-5xl font-semibold tracking-tight">Pace</h1>
        </div>

        <p
          className="animate-rise text-sm text-text-dim max-w-[240px] mb-10 leading-relaxed"
          style={{ animationDelay: '90ms' }}
        >
          Turn focused study into a game you play with friends.
        </p>

        <div
          className="animate-rise flex items-center gap-5 mb-10"
          style={{ animationDelay: '140ms' }}
        >
          {FEATURES.map(({ icon: Icon, label }) => (
            <div key={label} className="flex flex-col items-center gap-2 text-text-faint">
              <div className="w-10 h-10 rounded-xl bg-elevated border border-border flex items-center justify-center">
                <Icon />
              </div>
              <span className="text-[10px] tracking-wide">{label}</span>
            </div>
          ))}
        </div>

        <GoogleButton onClick={login} className="animate-rise" />

        <div className="animate-rise" style={{ animationDelay: '220ms' }}>
          {authError && <p className="text-xs text-danger mt-4">{authError}</p>}
        </div>
      </div>
    </div>
  )
}
