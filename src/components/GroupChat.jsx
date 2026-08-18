import { useEffect, useRef, useState } from 'react'
import { sendMessage } from '../lib/sessions'
import Avatar from './Avatar'
import { SendIcon } from './icons'

const EMOJIS = ['😀', '😂', '🤣', '😊', '😍', '🥳', '😎', '😭', '😅', '😮', '😡', '❤️', '🔥', '👍', '👏', '🙏', '💯', '✨', '🎯', '💪', '📚', '⏱️', '🚀', '🤝', '🙌', '🤔', '👀', '⭐', '💀', '😴', '🫡', '🫶']

export default function GroupChat({ groupId, messages, user, profile }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [messages.length])

  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const updateViewport = () => document.documentElement.style.setProperty('--pace-chat-vh', `${viewport.height}px`)
    updateViewport()
    viewport.addEventListener('resize', updateViewport)
    viewport.addEventListener('scroll', updateViewport)
    return () => {
      viewport.removeEventListener('resize', updateViewport)
      viewport.removeEventListener('scroll', updateViewport)
      document.documentElement.style.removeProperty('--pace-chat-vh')
    }
  }, [])

  async function handleSend() {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    setText('')
    setEmojiOpen(false)
    setSending(true)
    try {
      await sendMessage({
        groupId,
        uid: user.uid,
        displayName: profile?.displayName || user.displayName,
        photoURL: profile?.photoURL || user.photoURL,
        text: trimmed,
      })
    } catch {
      setText(trimmed)
    } finally {
      setSending(false)
      requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
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
      setText((value) => value + emoji)
      return
    }
    const start = input.selectionStart ?? text.length
    const end = input.selectionEnd ?? text.length
    const next = `${text.slice(0, start)}${emoji}${text.slice(end)}`.slice(0, 500)
    setText(next)
    requestAnimationFrame(() => {
      input.focus({ preventScroll: true })
      const caret = Math.min(start + emoji.length, next.length)
      input.setSelectionRange(caret, caret)
    })
  }

  return (
    <section className="flex flex-col min-h-0 flex-1 min-w-0" style={{ minHeight: '0', height: 'var(--pace-chat-vh, 100dvh)' }}>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-0 no-scrollbar">
        <div className="flex flex-col gap-2.5 py-1">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="text-sm text-text-dim">No messages yet</div>
              <div className="text-xs text-text-faint mt-1">Start the conversation.</div>
            </div>
          )}
          {messages.map((m) => {
            const own = m.uid === user.uid
            return (
              <div key={m.id} className={`flex items-end gap-2.5 w-full ${own ? 'justify-end' : 'justify-start'}`}>
                {!own && <Avatar name={m.displayName} photoURL={m.photoURL} size="sm" className="shrink-0" />}
                <div className={`max-w-[min(78%,520px)] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed break-words ${own ? 'bg-accent text-bg rounded-br-md' : 'bg-surface border border-border text-text rounded-bl-md'}`}>
                  {m.text}
                </div>
                {own && <Avatar name={m.displayName} photoURL={m.photoURL} size="sm" className="shrink-0" />}
              </div>
            )
          })}
          <div ref={bottomRef} className="h-1" />
        </div>
      </div>

      <div className="shrink-0 z-10 pt-2 pb-[max(0.25rem,env(safe-area-inset-bottom))] bg-bg/95 backdrop-blur-md">
        <div className="relative">
          {emojiOpen && (
            <div className="absolute bottom-full left-0 right-0 mb-2 rounded-2xl border border-border bg-surface p-2.5 shadow-xl z-20">
              <div className="grid grid-cols-8 sm:grid-cols-10 gap-1 max-h-48 overflow-y-auto overscroll-contain no-scrollbar">
                {EMOJIS.map((emoji) => (
                  <button key={emoji} type="button" onPointerDown={(e) => e.preventDefault()} onClick={() => insertEmoji(emoji)} className="h-9 w-full rounded-lg text-xl flex items-center justify-center hover:bg-elevated active:scale-90 transition-transform" aria-label={`Insert ${emoji}`}>
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-end gap-1.5 rounded-2xl border border-border bg-surface p-1.5 shadow-sm focus-within:border-text-faint transition-colors">
            <button type="button" aria-label="Open emoji picker" aria-expanded={emojiOpen} onPointerDown={(e) => e.preventDefault()} onClick={() => setEmojiOpen((open) => !open)} className="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center text-xl hover:bg-elevated active:scale-95 transition-all">
              😊
            </button>
            <textarea ref={inputRef} value={text} onChange={(e) => setText(e.target.value.slice(0, 500))} onKeyDown={handleKeyDown} placeholder="Message..." maxLength={500} rows={1} enterKeyHint="send" inputMode="text" name="pace-message" autoComplete="off" autoCorrect="off" autoCapitalize="sentences" spellCheck={false} data-form-type="other" className="min-w-0 flex-1 resize-none bg-transparent px-2.5 py-2 text-[16px] md:text-sm leading-5 outline-none placeholder:text-text-faint max-h-24 overflow-y-auto" />
            <button type="button" onPointerDown={(e) => e.preventDefault()} onClick={handleSend} aria-label="Send message" disabled={!text.trim() || sending} className="w-10 h-10 shrink-0 rounded-xl bg-accent text-bg flex items-center justify-center active:scale-95 transition-all duration-150 disabled:opacity-35 disabled:active:scale-100">
              <SendIcon />
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
