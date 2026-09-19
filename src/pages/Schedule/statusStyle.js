export const STATUS_STYLE = {
  done: { label: 'On time', className: 'bg-live-soft text-live' },
  // Deliberately not text-accent — accent is the brand gold used
  // everywhere else (the CTA, the Focus session indicator), so reusing
  // it here would make "you fell short" look like the same color as
  // "this is the primary action." A distinct warning tone keeps a clean
  // good/warning/bad three-way split.
  short: { label: null, className: 'bg-warn-soft text-warn' }, // label filled in per-block with the actual shortfall
  missed: { label: 'Missed', className: 'bg-danger-soft text-danger' },
  // 'upcoming' deliberately has no entry — StatusBadge renders nothing for
  // it, same as a block on a future day. Its time just hasn't come yet,
  // so there's nothing to report.
}
