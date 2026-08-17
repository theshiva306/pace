import { useEffect, useRef, useState } from 'react'
import { sendMessage } from '../lib/sessions'
import Avatar from './Avatar'
import { SendIcon } from './icons'

export default function GroupChat({ groupId, messages, user, profile }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [messages.length])

  async function handleSend() {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    setText('')
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
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <section className="flex flex-col min-h-0 animate-fade-in">
      <div className="flex-1 min-h-[260px] max-h-[58vh] overflow-y-auto overscroll-contain pr-1 -mr-1 no-scrollbar">
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

      <div className="sticky bottom-0 z-10 pt-3 pb-[max(0.25rem,env(safe-area-inset-bottom))] bg-bg/95 backdrop-blur-md">
        <div className="flex items-end gap-2 rounded-2xl border border-border bg-surface p-1.5 shadow-sm focus-within:border-text-faint transition-colors">
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 500))}
            onKeyDown={handleKeyDown}
            placeholder="Message..."
            maxLength={500}
            rows={1}
            enterKeyHint="send"
            autoComplete="off"
            autoCorrect="on"
            spellCheck
            className="min-w-0 flex-1 resize-none bg-transparent px-3 py-2 text-sm leading-5 outline-none placeholder:text-text-faint max-h-24 overflow-y-auto"
          />
          <button
            type="button"
            onClick={handleSend}
            aria-label="Send message"
            disabled={!text.trim() || sending}
            className="w-10 h-10 shrink-0 rounded-xl bg-accent text-bg flex items-center justify-center active:scale-95 transition-all duration-150 disabled:opacity-35 disabled:active:scale-100"
          >
            <SendIcon />
          </button>
        </div>
      </div>
    </section>
  )
}
