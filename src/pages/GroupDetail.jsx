import { useState, useMemo, useRef, useEffect } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useGroup, useWeeklyTotals } from '../hooks/useGroup'
import { useSessionClock } from '../hooks/useSessionClock'
import { formatDuration, formatClock, formatMessageTime } from '../lib/format'
import { sendMessage } from '../lib/sessions'
import { isoWeekId } from '../lib/week'
import Avatar from '../components/Avatar'
import Sheet from '../components/Sheet'
import Button from '../components/Button'
import { ChevronLeft, CopyIcon, ShareIcon, SendIcon } from '../components/icons'

const TABS = ['Leaderboard', 'Live', 'Chat']

export default function GroupDetail() {
  const { groupId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { user, profile } = useAuth()
  const { group, members, live, messages } = useGroup(groupId)
  const weekId = useMemo(() => isoWeekId(), [])
  const totals = useWeeklyTotals(groupId, weekId)

  // Arriving from the Timer page's live pill jumps straight to Live
  // instead of the default Leaderboard tab.
  const [tab, setTab] = useState(location.state?.tab === 'Live' ? 'Live' : 'Leaderboard')
  const [inviteOpen, setInviteOpen] = useState(false)

  // Route params can change without unmounting this component (e.g. one
  // pinned-group pill link to another), so re-apply the requested tab
  // whenever the target group changes.
  useEffect(() => {
    setTab(location.state?.tab === 'Live' ? 'Live' : 'Leaderboard')
  }, [groupId])

  const memberList = Object.entries(members).map(([uid, m]) => ({ uid, ...m }))

  return (
    <div className="min-h-svh px-5 pt-[calc(env(safe-area-inset-top)+20px)] pb-32 max-w-md mx-auto md:max-w-2xl md:pt-14 flex flex-col">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => navigate('/groups')} aria-label="Back" className="text-text-dim hover:text-text -ml-1.5 p-1.5">
          <ChevronLeft />
        </button>
        <div className="flex-1 min-w-0">
          <div className="font-display font-semibold tracking-tight uppercase text-lg truncate">
            {group?.name || '—'}
          </div>
          <div className="text-xs text-text-faint">{memberList.length} members</div>
        </div>
        <button
          onClick={() => setInviteOpen(true)}
          className="text-xs font-medium tracking-wide text-accent border border-accent/30 bg-accent-soft rounded-lg px-3 py-2"
        >
          Invite
        </button>
      </div>

      <div className="flex items-center gap-1 bg-surface border border-border rounded-xl p-1 mb-6">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 text-xs font-medium tracking-wide py-2 rounded-lg transition-colors ${
              tab === t ? 'bg-elevated text-text' : 'text-text-faint'
            }`}
          >
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      {tab === 'Leaderboard' && (
        <Leaderboard memberList={memberList} totals={totals} currentUid={user.uid} />
      )}
      {tab === 'Live' && (
        <Live memberList={memberList} live={live} currentUid={user.uid} />
      )}
      {tab === 'Chat' && (
        <Chat groupId={groupId} messages={messages} user={user} profile={profile} />
      )}

      <Sheet open={inviteOpen} onClose={() => setInviteOpen(false)}>
        <InviteSheetContent code={group?.inviteCode} />
      </Sheet>
    </div>
  )
}

function InviteSheetContent({ code }) {
  const [copied, setCopied] = useState(false)
  // Absolute link that works regardless of the GitHub Pages subpath —
  // built from the current origin + path, so it never needs a hardcoded
  // repo name.
  const link = code
    ? `${window.location.origin}${window.location.pathname}#/join/${code}`
    : ''

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard API unavailable — fall back silently, link is still selectable.
    }
  }

  function handleShare() {
    if (navigator.share) {
      navigator.share({ url: link, text: 'Join my group on Pace' }).catch(() => {})
    } else {
      handleCopy()
    }
  }

  return (
    <div className="flex flex-col items-center text-center">
      <div className="text-[13px] tracking-[0.25em] text-text-faint mb-5">INVITE A FRIEND</div>
      <div className="w-full bg-elevated border border-border rounded-xl px-4 py-3 mb-6 text-xs text-text-dim break-all">
        {link}
      </div>
      <div className="w-full flex gap-2.5">
        <Button variant="primary" className="flex-1" onClick={handleCopy}>
          <CopyIcon /> {copied ? 'Copied' : 'Copy link'}
        </Button>
        <Button variant="ghost" className="flex-1" onClick={handleShare}>
          <ShareIcon /> Share
        </Button>
      </div>
    </div>
  )
}

function Leaderboard({ memberList, totals, currentUid }) {
  const ranked = [...memberList]
    .map((m) => ({ ...m, seconds: totals[m.uid] || 0 }))
    .sort((a, b) => b.seconds - a.seconds)

  const medals = ['🥇', '🥈', '🥉']

  return (
    <div className="animate-fade-in">
      <div className="text-[13px] tracking-[0.25em] text-text-faint mb-4">THIS WEEK</div>
      <div className="flex flex-col">
        {ranked.map((m, i) => (
          <div
            key={m.uid}
            className={`flex items-center gap-4 py-3 border-b border-border-soft last:border-0 ${
              m.uid === currentUid ? 'bg-accent-soft/40 -mx-3 px-3 rounded-xl' : ''
            }`}
          >
            <span className="w-7 text-sm text-text-faint tabular-nums">
              {i < 3 ? medals[i] : i + 1}
            </span>
            <Avatar name={m.displayName} photoURL={m.photoURL} size="sm" />
            <span className="flex-1 text-sm font-medium truncate">{m.displayName}</span>
            <span className="text-sm tabular-nums text-text-dim">{formatDuration(m.seconds)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Live({ memberList, live, currentUid }) {
  const liveUids = new Set(Object.keys(live))
  const liveMembers = memberList.filter((m) => liveUids.has(m.uid))
  const idleMembers = memberList.filter((m) => !liveUids.has(m.uid))

  return (
    <div className="animate-fade-in">
      <div className="text-[13px] tracking-[0.25em] text-text-faint mb-4">LIVE</div>

      {liveMembers.length === 0 ? (
        <p className="text-text-dim text-sm py-6">No one studying</p>
      ) : (
        <div className="grid grid-cols-3 gap-3 mb-8">
          {liveMembers.map((m) => (
            <LiveTile key={m.uid} member={m} liveSession={live[m.uid]} self={m.uid === currentUid} />
          ))}
        </div>
      )}

      {idleMembers.length > 0 && (
        <>
          <div className="text-[13px] tracking-[0.25em] text-text-faint mb-3">NOT FOCUSING</div>
          <div className="flex flex-col gap-3">
            {idleMembers.map((m) => (
              <div key={m.uid} className="flex items-center gap-3">
                <Avatar name={m.displayName} photoURL={m.photoURL} size="sm" />
                <span className="text-sm text-text-dim">{m.displayName}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function LiveTile({ member, liveSession, self }) {
  const { focusElapsed, isPaused, isOnBreak } = useSessionClock(liveSession)
  const label = isOnBreak ? 'On break' : isPaused ? 'Paused' : formatClock(focusElapsed)
  return (
    <div className="flex flex-col items-center gap-2 bg-surface border border-border rounded-2xl py-4">
      <Avatar name={member.displayName} photoURL={member.photoURL} size="md" live={!isPaused && !isOnBreak} />
      <span className="text-xs font-medium truncate max-w-full px-1">
        {self ? 'You' : member.displayName}
      </span>
      <span className={`text-xs tabular-nums ${isPaused || isOnBreak ? 'text-text-faint' : 'text-live'}`}>
        {label}
      </span>
    </div>
  )
}

function Chat({ groupId, messages, user, profile }) {
  const [text, setText] = useState('')
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  async function handleSend() {
    const trimmed = text.trim()
    if (!trimmed) return
    setText('')
    await sendMessage({
      groupId,
      uid: user.uid,
      displayName: profile?.displayName || user.displayName,
      photoURL: profile?.photoURL || user.photoURL,
      text: trimmed,
    })
  }

  return (
    <div className="flex flex-col animate-fade-in">
      <div className="flex flex-col gap-4 mb-4 max-h-[50vh] overflow-y-auto no-scrollbar">
        {messages.length === 0 && <p className="text-text-dim text-sm py-4">No messages yet</p>}
        {messages.map((m) => (
          <div key={m.id} className={m.uid === user.uid ? 'text-right' : ''}>
            <div className="text-xs text-text-faint mb-1">
              {m.uid === user.uid ? 'You' : m.displayName} · {m.timestamp ? formatMessageTime(m.timestamp) : ''}
            </div>
            <div
              className={`inline-block max-w-[80%] text-sm px-3.5 py-2 rounded-2xl ${
                m.uid === user.uid ? 'bg-accent text-bg' : 'bg-surface border border-border'
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="flex items-center gap-2 border-t border-border pt-4">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Message..."
          maxLength={500}
          className="flex-1 bg-surface border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:border-text-faint"
        />
        <button
          onClick={handleSend}
          aria-label="Send"
          className="w-10 h-10 rounded-xl bg-accent text-bg flex items-center justify-center shrink-0 active:scale-95 transition-transform disabled:opacity-40"
          disabled={!text.trim()}
        >
          <SendIcon />
        </button>
      </div>
    </div>
  )
}
