import { useState, useMemo, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useGroup } from '../hooks/useGroup'
import { formatDuration, formatMessageTime, formatDayLabel } from '../lib/format'
import { sendMessage, renameGroup, removeMember, leaveGroup, deleteGroup } from '../lib/sessions'
import { weekInfo } from '../lib/week'
import { leagueStatus, LEAGUES } from '../lib/league'
import { dayId } from '../lib/day'
import Avatar from '../components/Avatar'
import GroupIcon from '../components/GroupIcon'
import { GroupHeaderSkeleton } from '../components/Skeleton'
import Sheet from '../components/Sheet'
import Button from '../components/Button'
import { Live, TierBadge } from '../components/LiveView'
import { ChevronLeft, ChevronDown, CopyIcon, ShareIcon, SendIcon, SettingsIcon, ExitIcon, TrashIcon, InviteIcon, LeagueIcon } from '../components/icons'

const TABS = ['Leaderboard', 'Live', 'Chat']
const WEEKS_BACK = 4

export default function GroupDetail() {
  const { groupId } = useParams()
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const todayId = useMemo(() => dayId(), [])
  const [tab, setTab] = useState('Leaderboard')
  const [weekOffset, setWeekOffset] = useState(0)
  const [weekPickerOpen, setWeekPickerOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [removeConfirmUid, setRemoveConfirmUid] = useState(null)
  const [busy, setBusy] = useState(false)
  const week = useMemo(() => weekInfo(weekOffset), [weekOffset])
  const { group, members, messages, weekly, sessionCounts, daily, live } = useGroup(groupId, week.weekId, todayId)
  const memberList = Object.entries(members).map(([uid, m]) => ({ uid, ...m }))
  const isAdmin = group?.adminUid === user.uid
  const [memberSheetUid, setMemberSheetUid] = useState(null)
  const memberSheetStats = useMemo(
    () => computeMemberStats(memberList, weekly || {}, sessionCounts || {}, memberSheetUid),
    [memberList, weekly, sessionCounts, memberSheetUid],
  )

  async function handleRename(name) {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      await renameGroup({ groupId, name: name.trim() })
    } finally {
      setBusy(false)
    }
  }

  async function handleRemoveMember(targetUid) {
    if (busy) return
    setBusy(true)
    try {
      await removeMember({ groupId, targetUid })
    } finally {
      setBusy(false)
    }
  }

  async function handleLeave() {
    if (busy) return
    setBusy(true)
    try {
      await leaveGroup({ uid: user.uid, groupId })
      setLeaveConfirmOpen(false)
      navigate('/groups')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (busy) return
    setBusy(true)
    try {
      await deleteGroup({ groupId, memberUids: memberList.map((m) => m.uid) })
      setDeleteConfirmOpen(false)
      navigate('/groups')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`px-5 pt-[calc(env(safe-area-inset-top)+20px)] pb-6 max-w-md mx-auto md:max-w-2xl md:pt-14 flex flex-col ${tab === 'Chat' ? 'h-[var(--pace-viewport-height,100dvh)] min-h-0 overflow-hidden' : 'min-h-svh'}`}>
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => navigate('/groups')} aria-label="Back" className="text-text-dim hover:text-text -ml-1.5 p-1.5">
          <ChevronLeft />
        </button>
        <div className="flex items-center gap-2">
          <button onClick={() => setInviteOpen(true)} className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-live border border-live/30 bg-live-soft rounded-full pl-3 pr-3.5 py-2">
            <InviteIcon /> Invite friends
          </button>
          <button onClick={() => setSettingsOpen(true)} aria-label="Group settings" className="text-text-dim hover:text-text p-2 rounded-full border border-border bg-surface">
            <SettingsIcon />
          </button>
        </div>
      </div>

      {group === undefined ? (
        <GroupHeaderSkeleton />
      ) : (
        <div className="flex items-center gap-3.5 mb-6">
          <GroupIcon groupId={groupId} size="md" />
          <div className="flex-1 min-w-0">
            <div className="font-display font-semibold tracking-tight uppercase text-lg truncate">{group?.name || '—'}</div>
            <div className="text-xs text-text-faint">{memberList.length} members</div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-6 border-b border-border-soft mb-6">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`relative flex items-center gap-1.5 text-xs font-medium tracking-wide py-3 transition-colors ${tab === t ? 'text-text' : 'text-text-faint'}`}
          >
            {t === 'Live' && <span className="w-1.5 h-1.5 rounded-full bg-live" aria-hidden />}
            {t}
            {tab === t && <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-text rounded-full" />}
          </button>
        ))}
      </div>

      {tab === 'Leaderboard' && (
        <Leaderboard
          memberList={memberList}
          totals={weekly || {}}
          currentUid={user.uid}
          week={week}
          onOpenWeekPicker={() => setWeekPickerOpen(true)}
          onSelectMember={setMemberSheetUid}
        />
      )}
      {tab === 'Live' && (
        <Live
          memberList={memberList}
          live={live || {}}
          totals={daily || {}}
          weekly={weekly || {}}
          currentUid={user.uid}
          onSelectMember={setMemberSheetUid}
          onInvite={() => setInviteOpen(true)}
        />
      )}
      {tab === 'Chat' && <Chat groupId={groupId} messages={messages} user={user} profile={profile} />}

      <Sheet open={!!memberSheetUid} onClose={() => setMemberSheetUid(null)}>
        <MemberDetailContent stats={memberSheetStats} self={memberSheetUid === user.uid} />
      </Sheet>
      <Sheet open={weekPickerOpen} onClose={() => setWeekPickerOpen(false)}>
        <WeekPickerContent selected={weekOffset} onSelect={(offset) => { setWeekOffset(offset); setWeekPickerOpen(false) }} />
      </Sheet>
      <Sheet open={inviteOpen} onClose={() => setInviteOpen(false)}>
        <InviteSheetContent groupId={groupId} />
      </Sheet>
      <Sheet open={settingsOpen} onClose={() => setSettingsOpen(false)}>
        <SettingsSheetContent
          group={group}
          memberList={memberList}
          isAdmin={isAdmin}
          busy={busy}
          onRename={handleRename}
          onRequestRemove={setRemoveConfirmUid}
          onRequestLeave={() => { setSettingsOpen(false); setLeaveConfirmOpen(true) }}
          onRequestDelete={() => { setSettingsOpen(false); setDeleteConfirmOpen(true) }}
        />
      </Sheet>
      <Sheet open={leaveConfirmOpen} onClose={() => setLeaveConfirmOpen(false)}>
        <ConfirmSheet
          title="Leave this group?"
          subtitle={
            isAdmin && memberList.length > 1
              ? "You're the admin — another member will be promoted to take over."
              : isAdmin
                ? "You're the last member — the group will be deleted."
                : "You'll need a new invite link to rejoin."
          }
          confirmLabel="Leave group"
          busy={busy}
          onConfirm={handleLeave}
          onCancel={() => setLeaveConfirmOpen(false)}
        />
      </Sheet>
      <Sheet open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)}>
        <ConfirmSheet
          title="Delete this group?"
          subtitle="This removes it for everyone and can't be undone."
          confirmLabel="Delete group"
          busy={busy}
          onConfirm={handleDelete}
          onCancel={() => setDeleteConfirmOpen(false)}
        />
      </Sheet>
      <Sheet open={!!removeConfirmUid} onClose={() => setRemoveConfirmUid(null)}>
        <ConfirmSheet
          title="Remove this member?"
          subtitle="They will leave this group and will need a new invite to rejoin."
          confirmLabel="Remove member"
          busy={busy}
          onConfirm={async () => { await handleRemoveMember(removeConfirmUid); setRemoveConfirmUid(null) }}
          onCancel={() => setRemoveConfirmUid(null)}
        />
      </Sheet>
    </div>
  )
}

function ConfirmSheet({ title, subtitle, confirmLabel, busy, onConfirm, onCancel }) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="text-base font-medium mb-2">{title}</div>
      <p className="text-xs text-text-faint mb-8">{subtitle}</p>
      <div className="w-full flex flex-col gap-2.5">
        <Button variant="danger" className="w-full" onClick={onConfirm} disabled={busy}>{confirmLabel}</Button>
        <Button variant="text" className="w-full" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

function WeekPickerContent({ selected, onSelect }) {
  const weeks = Array.from({ length: WEEKS_BACK }, (_, i) => weekInfo(i))
  return (
    <div className="flex flex-col text-left">
      <div className="text-[13px] tracking-[0.25em] text-text-faint mb-5 text-center">SELECT WEEK</div>
      <div className="flex flex-col gap-1.5">
        {weeks.map((w) => (
          <button
            key={w.weekId}
            onClick={() => onSelect(w.weeksAgo)}
            className={`flex items-center justify-between rounded-xl px-4 py-3 text-sm transition-colors ${w.weeksAgo === selected ? 'bg-elevated text-text' : 'text-text-dim hover:bg-elevated/50'}`}
          >
            <span className="font-medium">{w.label}</span>
            <span className="text-xs text-text-faint">
              {w.isCurrent ? `Ends in ${w.daysLeft} day${w.daysLeft === 1 ? '' : 's'}` : 'Session ended'}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function InviteSheetContent({ groupId }) {
  const [copied, setCopied] = useState(false)
  const link = groupId ? `${window.location.origin}${window.location.pathname}#/join/${groupId}` : ''

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard access can fail (permissions, insecure context) — the
      // link is still visible in the sheet for the person to copy by hand.
    }
  }

  function handleShare() {
    if (navigator.share) navigator.share({ url: link, text: 'Join my group on Pace' }).catch(() => {})
    else handleCopy()
  }

  return (
    <div className="flex flex-col items-center text-center">
      <div className="text-[13px] tracking-[0.25em] text-text-faint mb-5">INVITE A FRIEND</div>
      <div className="w-full bg-elevated border border-border rounded-xl px-4 py-3 mb-6 text-xs text-text-dim break-all">{link}</div>
      <div className="w-full flex gap-2.5">
        <Button variant="primary" className="flex-1" onClick={handleCopy}><CopyIcon /> {copied ? 'Copied' : 'Copy link'}</Button>
        <Button variant="ghost" className="flex-1" onClick={handleShare}><ShareIcon /> Share</Button>
      </div>
    </div>
  )
}

function SettingsSheetContent({ group, memberList, isAdmin, busy, onRename, onRequestLeave, onRequestDelete, onRequestRemove }) {
  const [name, setName] = useState(group?.name || '')
  useEffect(() => { setName(group?.name || '') }, [group?.name])
  const dirty = !!name.trim() && name.trim() !== group?.name

  return (
    <div className="flex flex-col text-left max-h-[78vh] overflow-y-auto no-scrollbar -mx-1">
      <div className="flex items-center gap-3 px-1 mb-7">
        <div className="w-10 h-10 rounded-xl bg-elevated border border-border flex items-center justify-center shrink-0">
          <SettingsIcon width="19" height="19" />
        </div>
        <div className="min-w-0">
          <div className="text-base font-semibold tracking-tight">Group settings</div>
          <div className="text-xs text-text-faint truncate">{group?.name || 'Your group'}</div>
        </div>
      </div>

      <section className="mb-7">
        <div className="text-[10px] tracking-[0.22em] text-text-faint mb-3">MEMBERS · {memberList.length}</div>
        <div className="rounded-2xl border border-border bg-elevated/40 overflow-hidden">
          {memberList.length === 0 ? (
            <div className="px-4 py-4 text-xs text-text-faint">No members.</div>
          ) : memberList.map((m, i) => {
            const memberIsAdmin = m.uid === group?.adminUid
            return (
              <div key={m.uid} className={`flex items-center gap-3 px-4 py-3.5 ${i < memberList.length - 1 ? 'border-b border-border-soft' : ''}`}>
                <Avatar name={m.displayName} photoURL={m.photoURL} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{m.displayName}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-[9px] tracking-[0.16em] rounded-full px-2 py-1 ${memberIsAdmin ? 'text-accent border border-accent/20 bg-accent/5' : 'text-text-faint border border-border bg-surface'}`}>
                    {memberIsAdmin ? 'ADMIN' : 'MEMBER'}
                  </span>
                  {isAdmin && !memberIsAdmin && (
                    <button onClick={() => onRequestRemove(m.uid)} disabled={busy} className="text-xs font-medium text-danger px-2 py-1 disabled:opacity-40">
                      Remove
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {isAdmin && (
        <section className="mb-7">
          <div className="text-[10px] tracking-[0.22em] text-text-faint mb-3">ADMIN</div>
          <div className="rounded-2xl border border-border bg-elevated/40 overflow-hidden">
            <div className="px-4 py-4">
              <label className="text-xs text-text-faint block mb-2">Group name</label>
              <div className="flex gap-2">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value.slice(0, 24))}
                  onKeyDown={(e) => { if (e.key === 'Enter' && dirty) onRename(name) }}
                  className="min-w-0 flex-1 bg-surface border border-border rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-text-faint"
                  placeholder="Group name"
                />
                <Button variant="ghost" onClick={() => onRename(name)} disabled={!dirty || busy}>Save</Button>
              </div>
            </div>
            <div className="px-4 py-3.5 border-t border-border-soft text-xs text-text-faint">
              Only admins can change the group name or remove members.
            </div>
          </div>
        </section>
      )}
      <section className="mb-2 pt-5 border-t border-border-soft">
        <Button variant="ghost" className="w-full justify-start" onClick={onRequestLeave}><ExitIcon /> Leave group</Button>
        {isAdmin && (
          <Button variant="danger" className="w-full mt-2 justify-start" onClick={onRequestDelete}><TrashIcon /> Delete group</Button>
        )}
      </section>
    </div>
  )
}
function computeMemberStats(memberList, weeklyTotals, sessionCounts, uid) {
  if (!uid) return null
  const ranked = [...memberList]
    .map((m) => ({ ...m, seconds: weeklyTotals[m.uid] || 0 }))
    .sort((a, b) => b.seconds - a.seconds)
  const idx = ranked.findIndex((m) => m.uid === uid)
  if (idx === -1) return null
  const m = ranked[idx]
  const sessions = sessionCounts[uid] || 0
  return {
    uid: m.uid,
    displayName: m.displayName,
    photoURL: m.photoURL,
    seconds: m.seconds,
    sessions,
    avgSeconds: sessions > 0 ? Math.round(m.seconds / sessions) : 0,
    league: m.seconds > 0 && idx < 3 ? LEAGUES[idx] : null,
    rank: m.seconds > 0 ? idx + 1 : null,
  }
}

function MemberDetailContent({ stats, self }) {
  if (!stats) return <div className="py-10 text-center text-sm text-text-dim">Loading…</div>
  return (
    <div className="flex flex-col items-center text-center">
      <Avatar name={stats.displayName} photoURL={stats.photoURL} size="lg" className="mb-4" />
      <div className="text-lg font-semibold mb-2">{self ? 'You' : stats.displayName}</div>
      <div className="flex items-center gap-1.5 text-xs text-text-dim mb-6">
        {stats.league && <LeagueIcon width="16" height="16" className={stats.league.textClass} />}
        <span>{stats.rank ? `Rank ${stats.rank}` : '—'}</span>
      </div>
      <div className="w-full bg-elevated border border-border rounded-2xl p-5">
        <div className="text-center pb-4 mb-4 border-b border-border-soft">
          <div className="text-2xl font-display font-semibold tabular-nums">{formatDuration(stats.seconds)}</div>
          <div className="text-xs text-text-faint mt-1">This week's focus</div>
        </div>
        <div className="flex">
          <div className="flex-1 text-center">
            <div className="text-lg font-semibold tabular-nums">{stats.sessions}</div>
            <div className="text-xs text-text-faint mt-1">No. of sessions</div>
          </div>
          <div className="flex-1 text-center border-l border-border-soft">
            <div className="text-lg font-semibold tabular-nums">
              {stats.sessions > 0 ? formatDuration(stats.avgSeconds) : '—'}
            </div>
            <div className="text-xs text-text-faint mt-1">Avg focus per session</div>
          </div>
        </div>
      </div>
    </div>
  )
}
function getLeaderboardRankDisplay(seconds, index) {
  if (seconds <= 0) return '—'
  return index + 1
}
function Leaderboard({ memberList, totals, currentUid, week, onOpenWeekPicker, onSelectMember }) {
  const ranked = [...memberList]
    .map((m) => ({ ...m, seconds: totals[m.uid] || 0 }))
    .sort((a, b) => b.seconds - a.seconds)
  const currentSeconds = totals[currentUid] || 0
  const mine = currentSeconds > 0 ? leagueStatus(ranked, currentUid, { final: !week.isCurrent }) : null

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6 gap-3">
        <button onClick={onOpenWeekPicker} className="flex items-center gap-1.5 text-left">
          <div>
            <div className="text-sm font-semibold tracking-tight">{week.label}</div>
            <div className="text-[11px] text-text-faint">
              {week.isCurrent ? `Ends in ${week.daysLeft} day${week.daysLeft === 1 ? '' : 's'}` : 'Session ended'}
            </div>
          </div>
          <ChevronDown className="text-text-faint mt-2.5" />
        </button>
        {mine && (
          <div className="flex items-center gap-2 shrink-0">
            <span className={`w-6 h-6 rounded-[7px] flex items-center justify-center shrink-0 ${mine.chipClass}`}>
              <LeagueIcon width={14} height={14} className="text-bg" />
            </span>
            <div className="text-right">
              <div className={`text-xs font-semibold tracking-wide leading-tight ${mine.textClass}`}>{mine.name} league</div>
              <div className="text-[11px] text-text-faint leading-tight">{mine.detail}</div>
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-col">
        {ranked.map((m, i) => {
          const tier = m.seconds > 0 && i < 3 ? LEAGUES[i] : null
          return (
            <button
              key={m.uid}
              onClick={() => onSelectMember(m.uid)}
              className={`flex items-center gap-4 py-3 border-b border-border-soft last:border-0 text-left ${m.uid === currentUid ? 'bg-accent-soft/40 -mx-3 px-3 rounded-xl' : ''}`}
            >
              <span className="w-7 flex items-center justify-center text-sm text-text-faint tabular-nums">
                {getLeaderboardRankDisplay(m.seconds, i)}
              </span>
              <div className="relative">
                <Avatar name={m.displayName} photoURL={m.photoURL} size="sm" tier={tier} />
                <TierBadge tier={tier} size="sm" />
              </div>
              <span className="flex-1 text-sm font-medium truncate">{m.displayName}</span>
              <span className="text-sm tabular-nums text-text-dim">{formatDuration(m.seconds)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

const CHAT_EMOJIS = ['😀','😂','🤣','😊','😍','🥳','😎','😭','😅','😮','😡','❤️','🔥','👍','👏','🙏','💯','✨','🎯','💪','📚','⏱️','🚀','😴','🤝','🙌','💀','🤔','👀','😇','❤️‍🔥','⭐']

// Groups consecutive messages by calendar day so a divider ("Today",
// "Yesterday", "Monday" …) can be dropped in between, the way every
// mainstream chat app segments history.
function withDayDividers(messages) {
  const out = []
  let lastLabel = null
  for (const m of messages) {
    const label = formatDayLabel(m.timestamp || Date.now())
    if (label !== lastLabel) {
      out.push({ kind: 'divider', id: `divider-${m.id}`, label })
      lastLabel = label
    }
    out.push({ kind: 'message', ...m })
  }
  return out
}

function Chat({ groupId, messages, user, profile }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const [unseen, setUnseen] = useState(0)
  const scrollRef = useRef(null)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const prevCount = useRef(messages.length)

  const items = useMemo(() => withDayDividers(messages), [messages])

  useEffect(() => {
    const grew = messages.length > prevCount.current
    prevCount.current = messages.length
    if (!grew) return
    const last = messages[messages.length - 1]
    if (atBottom || last?.uid === user.uid) {
      bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
    } else {
      setUnseen((n) => n + 1)
    }
  }, [messages, atBottom, user.uid])

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    setAtBottom(nearBottom)
    if (nearBottom) setUnseen(0)
  }

  // Keeps the last message pinned just above the composer as the on-screen
  // keyboard opens/closes. The keyboard resizes window.visualViewport (not
  // window itself), which is what App.jsx's --pace-viewport-height tracks to
  // shrink this panel — but shrinking the panel alone doesn't move our
  // scroll position, so without this the latest message can end up hidden
  // above the fold instead of sitting right above the input bar.
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv || !atBottom) return
    const snapToBottom = () => {
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'auto' })
      })
    }
    vv.addEventListener('resize', snapToBottom)
    return () => vv.removeEventListener('resize', snapToBottom)
  }, [atBottom])

  function scrollToBottom() {
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
    setUnseen(0)
  }

  function autoGrow(el) {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 116)}px`
  }

  async function handleSend() {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    setText('')
    requestAnimationFrame(() => autoGrow(inputRef.current))
    setSending(true)
    try {
      await sendMessage({
        groupId,
        uid: user.uid,
        displayName: profile?.displayName || user.displayName,
        photoURL: profile?.photoURL || user.photoURL,
        text: trimmed,
      })
      requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
    } catch {
      setText(trimmed)
    } finally {
      setSending(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function insertEmoji(emoji) {
    const input = inputRef.current
    if (!input) {
      setText((value) => (value + emoji).slice(0, 500))
      return
    }
    const start = input.selectionStart ?? text.length
    const end = input.selectionEnd ?? text.length
    const next = (text.slice(0, start) + emoji + text.slice(end)).slice(0, 500)
    setText(next)
    requestAnimationFrame(() => {
      autoGrow(input)
      input.focus({ preventScroll: true })
      const pos = Math.min(start + emoji.length, 500)
      input.setSelectionRange(pos, pos)
    })
  }

  const remaining = 500 - text.length
  const nearLimit = remaining <= 40

  return (
    <div className="relative flex flex-col flex-1 min-h-0 h-full -mx-1 animate-fade-in">
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto overscroll-contain no-scrollbar pr-0 pb-2">
        <div className="min-h-full flex flex-col justify-end">
        {messages.length === 0 && (
          <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-1 text-center">
            <div className="text-sm text-text-dim">No messages yet</div>
            <div className="text-xs text-text-faint">Say hello to the group.</div>
          </div>
        )}
        {items.map((item, i) => {
          if (item.kind === 'divider') {
            return (
              <div key={item.id} className="flex items-center justify-center py-4 first:pt-1">
                <span className="text-[10px] font-medium tracking-[0.14em] text-text-faint bg-surface border border-border-soft rounded-full px-3 py-1">
                  {item.label.toUpperCase()}
                </span>
              </div>
            )
          }
          const m = item
          const prevItem = items[i - 1]
          const nextItem = items[i + 1]
          const mine = m.uid === user.uid
          const isFirstInRun = !prevItem || prevItem.kind !== 'message' || prevItem.uid !== m.uid
          const isLastInRun = !nextItem || nextItem.kind !== 'message' || nextItem.uid !== m.uid
          return (
            <div key={m.id} className={`flex w-full items-end gap-2 ${mine ? 'justify-end' : 'justify-start'} ${isFirstInRun ? 'mt-3' : 'mt-0.5'}`}>
              {!mine && (
                isLastInRun
                  ? <Avatar name={m.displayName} photoURL={m.photoURL} size="sm" className="mb-0.5" />
                  : <div className="w-8 shrink-0" aria-hidden />
              )}
              <div className={`flex max-w-[78%] min-w-0 flex-col ${mine ? 'items-end' : 'items-start'}`}>
                {!mine && isFirstInRun && (
                  <span className="px-1 mb-0.5 text-[11px] font-medium text-text-faint truncate max-w-full">{m.displayName || 'Member'}</span>
                )}
                <div className={`break-words whitespace-pre-wrap rounded-2xl pl-3.5 pr-2.5 py-2.5 text-sm leading-relaxed ${mine ? 'bg-accent text-bg rounded-br-md' : 'bg-surface border border-border text-text rounded-bl-md'}`}>
                  {m.text}
                  {isLastInRun && (
                    <span className={`float-right whitespace-nowrap select-none mt-1.5 -mb-1 ml-2 text-[10px] tabular-nums ${mine ? 'text-bg/70' : 'text-text-faint'}`}>
                      {m.timestamp ? formatMessageTime(m.timestamp) : 'Sending…'}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} className="h-px" />
        </div>
      </div>

      {!atBottom && messages.length > 0 && (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label="Scroll to latest messages"
          className="absolute right-2 bottom-[calc(env(safe-area-inset-bottom)+64px)] z-20 flex items-center gap-1.5 rounded-full border border-border bg-surface/95 backdrop-blur-md pl-3 pr-2.5 py-2 text-xs font-medium text-text-dim shadow-lg active:scale-95 transition-transform"
        >
          {unseen > 0 ? `${unseen} new` : 'Latest'}
          <ChevronDown className="rotate-0" />
        </button>
      )}

      {emojiOpen && (
        <div className="absolute bottom-[calc(env(safe-area-inset-bottom)+68px)] left-0 right-0 z-20 rounded-2xl border border-border bg-surface/98 p-2 shadow-2xl backdrop-blur-md">
          <div className="grid grid-cols-8 sm:grid-cols-10 gap-0.5 max-h-48 overflow-y-auto no-scrollbar">
            {CHAT_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => insertEmoji(emoji)}
                className="h-10 rounded-xl text-xl flex items-center justify-center hover:bg-elevated active:scale-90 transition-transform"
                aria-label={`Insert ${emoji}`}
              >{emoji}</button>
            ))}
          </div>
        </div>
      )}

      {/* Deliberately not a <form>: on Android Chrome, wrapping a text field
          in a <form> makes the browser treat it as a fillable form and show
          its password/payment/address autofill accessory bar above the
          keyboard. A plain container with explicit key + click handlers
          keeps the exact same UX without that browser chrome. */}
      <div className="sticky bottom-0 z-10 border-t border-border-soft bg-bg/95 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-md">
        {nearLimit && (
          <div className="px-1 pb-1 text-right text-[10px] tabular-nums text-text-faint">{remaining} characters left</div>
        )}
        <div className="flex items-end gap-2">
          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => { setEmojiOpen((open) => !open); requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true })) }}
            aria-label="Emoji"
            aria-expanded={emojiOpen}
            className="w-11 h-11 rounded-2xl bg-surface border border-border text-text-dim flex items-center justify-center shrink-0 text-xl active:scale-95 transition-transform"
          >😊</button>
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => { setText(e.target.value.slice(0, 500)); autoGrow(e.target) }}
            onKeyDown={handleKeyDown}
            onFocus={() => { if (atBottom) requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'auto' })) }}
            placeholder="Message…"
            maxLength={500}
            rows={1}
            name="pace-chat-message"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="sentences"
            enterKeyHint="send"
            inputMode="text"
            spellCheck="false"
            data-form-type="other"
            data-lpignore="true"
            data-1p-ignore=""
            data-bwignore="true"
            className="min-w-0 flex-1 resize-none max-h-[116px] bg-surface border border-border rounded-2xl px-4 py-[11px] text-base leading-5 outline-none focus:border-text-faint placeholder:text-text-faint overflow-y-auto no-scrollbar"
          />
          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onClick={handleSend}
            aria-label="Send message"
            disabled={!text.trim() || sending}
            className="w-11 h-11 rounded-2xl bg-accent text-bg flex items-center justify-center shrink-0 active:scale-95 transition-transform disabled:opacity-35 disabled:cursor-not-allowed"
          >
            <SendIcon />
          </button>
        </div>
      </div>
    </div>
  )
}
