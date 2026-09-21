// 마법사가 쓰는 작은 조각들.
//
// ppt의 styles.css(3,515줄)는 들고 오지 않는다. 그대로 옮기면 한 앱 안에서 두 가지 모양이
// 되고, 출석 화면과 슬라이드 화면이 같은 로그인 뒤에 있는데 서로 다른 앱처럼 보인다.
//
// **처음에는 색만 갈아입혔는데, 그것으로는 한 벌이 되지 않았다.** 토큰은 출석과 같은데
// 모양이 달랐기 때문이다 — 버튼이 `rounded-md`(출석은 `rounded-full`), 입력칸이
// `rounded-md`에 포커스 링이 없고(출석은 `rounded-xl` + 링), 카드가 테두리도 그림자도
// 없는 맨 표면(출석은 `rounded-2xl` + 테두리 + 그림자)이었다. 같은 파랑을 쓰는 다른 앱은
// 여전히 다른 앱이다.
//
// 그래서 이 파일은 이제 **출석의 기본 조각들(`components/ui/`)을 감싸기만 한다.** 여기
// 남는 것은 마법사에만 있는 조합(제목+설명을 단 카드, 라벨+힌트를 단 입력칸, 파일 고르기)
// 뿐이고, 모양은 한 곳에서만 정해진다 — 출석 쪽 버튼이 바뀌면 슬라이드도 따라 바뀐다.
import type { ReactNode } from 'react'
import { Button as BaseButton, type ButtonProps } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Select as BaseSelect } from '../../components/ui/Select'

/** 제목(과 설명)을 단 카드. 출석의 통계·설정 카드와 같은 모양이다. */
export function Card({ title, hint, children }: { title?: string; hint?: string; children: ReactNode }) {
  return (
    <section className="surface-panel p-5">
      {(title || hint) && (
        <div className="mb-4 border-b border-separator pb-3">
          {title && <h2 className="font-display text-base font-bold tracking-tight text-text">{title}</h2>}
          {hint && <p className={'text-[13px] leading-6 text-muted' + (title ? ' mt-1.5' : '')}>{hint}</p>}
        </div>
      )}
      {children}
    </section>
  )
}

/** 라벨을 단 입력 한 칸. 라벨 활자는 출석의 `.field-label`과 같은 것이다. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs leading-5 text-subtle">{hint}</span>}
    </label>
  )
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <Input {...props} />
}

// 출석에는 여러 줄 입력이 없어서 짝이 될 조각도 없다. Input과 **같은 칠**을 쓰되 높이만
// 준다 — 한 줄과 여러 줄이 나란히 섰을 때 테두리와 포커스 링이 어긋나지 않아야 한다.
export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = '', ...rest } = props
  return (
    <textarea
      {...rest}
      className={
        'w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-text ' +
        'min-h-24 resize-y text-sm font-sans leading-relaxed placeholder:text-subtle outline-none ' +
        'shadow-[inset_0_1px_1px_rgba(0,0,0,0.02)] ' +
        'transition-[border-color,box-shadow,background-color] duration-200 [transition-timing-function:var(--ease-out-soft)] ' +
        'hover:border-primary/30 focus-visible:border-primary focus-visible:ring-[3.5px] focus-visible:ring-primary/18 ' +
        className
      }
    />
  )
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <BaseSelect {...props} />
}

// ppt의 변이 이름(plain · primary · danger)은 부르는 자리가 마흔 곳이라 그대로 두고, 출석의
// 변이로 옮겨 적기만 한다. `danger`가 `dangerQuiet`인 것은 여기 쓰이는 자리가 곡 한 줄을
// 지우는 인라인 버튼이라, 목록 위에서 꽉 찬 빨강이어야 할 이유가 없기 때문이다.
const VARIANT: Record<'plain' | 'primary' | 'danger', ButtonProps['variant']> = {
  plain: 'secondary',
  primary: 'primary',
  danger: 'dangerQuiet',
}

export function Button({
  variant = 'plain',
  size = 'md',
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
  variant?: 'plain' | 'primary' | 'danger'
  size?: ButtonProps['size']
}) {
  // 기본 type이 submit이면 form 안의 버튼 하나가 페이지를 날려 보낸다. ppt에서 넘어온
  // 마크업이 그것을 기대하고 있으므로 감싸는 쪽에서 계속 박아 둔다.
  return <BaseButton type="button" variant={VARIANT[variant]} size={size} {...props} />
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
    // 버튼이 아니라 <label>이라 Button 조각을 쓸 수 없다. 대신 secondary 버튼과 **같은**
    // 칠을 적어 둔다 — 나란히 서는 자리라 하나만 각지면 그것이 먼저 보인다.
    <label
      className={
        'inline-flex min-h-11 cursor-pointer select-none items-center justify-center gap-2 rounded-full ' +
        'border border-border bg-surface px-5 py-2.5 font-sans text-sm font-semibold tracking-[-0.01em] text-text ' +
        'shadow-[var(--shadow-sm)] transition-[background-color,border-color,transform] duration-200 ' +
        '[transition-timing-function:var(--ease-out-soft)] hover:border-primary/30 hover:bg-surface-alt active:scale-[0.96]'
      }
    >
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
  return <p className={`text-[13px] leading-6 ${tone}`}>{children}</p>
}
