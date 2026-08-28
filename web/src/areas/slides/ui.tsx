// 마법사가 쓰는 작은 조각들.
//
// ppt의 styles.css(3,515줄)는 들고 오지 않는다. 그대로 옮기면 한 앱 안에서 두 가지 모양이
// 되고, 출석 화면과 슬라이드 화면이 같은 로그인 뒤에 있는데 서로 다른 앱처럼 보인다.
// 마크업은 옮기되 **클래스는 KCCP 토큰으로 갈아입힌다** (web/src/index.css의 @theme).
import type { ReactNode } from 'react'

export function Card({ title, hint, children }: { title?: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg bg-surface p-4">
      {title && <h2 className="text-xs font-medium uppercase tracking-widest text-subtle">{title}</h2>}
      {hint && <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{hint}</p>}
      <div className={title || hint ? 'mt-3' : ''}>{children}</div>
    </section>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-text">{label}</span>
      {children}
      {hint && <span className="text-xs leading-relaxed text-subtle">{hint}</span>}
    </label>
  )
}

const inputBase =
  'w-full rounded-md border border-border bg-canvas px-3 py-2 text-[15px] text-text ' +
  'placeholder:text-subtle focus:border-primary focus:outline-none'

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputBase} ${props.className ?? ''}`} />
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputBase} min-h-24 resize-y leading-relaxed ${props.className ?? ''}`} />
}

export function Button({
  variant = 'plain',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'plain' | 'primary' | 'danger' }) {
  const styles = {
    plain: 'bg-fill text-text hover:bg-fill-hover',
    primary: 'bg-primary text-primary-fg hover:bg-primary-hover',
    danger: 'bg-transparent text-danger hover:bg-fill',
  }[variant]
  return (
    <button
      type="button"
      {...props}
      className={`rounded-md px-3 py-2 text-[14px] font-medium transition-colors disabled:opacity-40 ${styles} ${className}`}
    />
  )
}

/** 파일을 고르는 자리. 라벨이 곧 버튼이라 브라우저 기본 파일 입력의 모양을 쓰지 않는다. */
export function FilePicker({
  label,
  accept,
  multiple,
  onFiles,
}: {
  label: string
  accept: string
  multiple?: boolean
  onFiles: (files: File[]) => void
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-fill px-3 py-2 text-[14px] font-medium text-text hover:bg-fill-hover">
      {label}
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          // 같은 파일을 다시 고를 수 있어야 한다 — 값을 비우지 않으면 change가 오지 않는다.
          e.target.value = ''
          if (files.length) onFiles(files)
        }}
      />
    </label>
  )
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'error'; children: ReactNode }) {
  const tone = kind === 'error' ? 'text-danger' : 'text-muted'
  return <p className={`text-[13px] leading-relaxed ${tone}`}>{children}</p>
}
