#!/usr/bin/env bash
# 백업 시크릿 다섯 개를 GitHub에 넣기 **전에**, 본인 컴퓨터에서 한 번에 확인한다.
#
# ── 왜 미리 확인하는가 ────────────────────────────────────────────────────────────────
# 시크릿을 넣고 워크플로를 돌려서 실패하면 원인이 다섯 갈래다 — 그런데 GitHub Actions 의
# 로그는 값을 가려 주므로(그래야 맞다) "어느 것이 틀렸는지"가 잘 안 보인다. 여기서 먼저
# 하나씩 두드려 보면 틀린 것이 즉시 이름으로 나온다.
#
# ── 이 스크립트는 값을 어디에도 보내지 않는다 ──────────────────────────────────────────
# 물어보거나 환경 변수로 받아 그 자리에서 쓰고 버린다. 파일에 적지 않고, 화면에도 찍지
# 않는다 (age 개인키만은 경로로 받는다 — 내용을 읽지 않기 위해서다).
# **AI 세션에 붙여넣지 마라.**
#
# 쓰는 법 — **그냥 돌려라. 물어본다.**
#
#   bash scripts/backup/preflight.sh
#
# 값이 비어 있으면 하나씩 물어본다 (비밀번호·시크릿 키는 화면에 찍히지 않는다).
# 이렇게 만든 이유: `export VAR='값'   # 설명` 을 그대로 붙여넣는 길이 **zsh 에서는
# 조용히 깨진다** — zsh 의 대화형 셸은 기본적으로 `#` 을 주석으로 보지 않아서
# (`INTERACTIVE_COMMENTS` 가 꺼져 있다) 그 줄 전체가 `export: not valid in this
# context` 로 죽고, 그러면 그 변수만 **빈 채로** 다음 검사에 들어간다. 즉
# 붙여넣기 실수가 "값이 틀렸다"로 둔갑한다. 물어보면 그 길 자체가 없어진다.
#
# CI 나 반복 실행을 위해 환경 변수로 주는 길도 그대로 둔다 (주면 묻지 않는다):
#
#   PGPASSWORD=… BACKUP_AGE_PUBLIC_KEY=… R2_ENDPOINT=… \
#   AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… bash scripts/backup/preflight.sh
#
# 넷 다 초록이면 그 값들을 그대로 GitHub 시크릿에 넣으면 된다 (이름은 아래 표).
set -uo pipefail

# 워크플로(.github/workflows/backup.yml)가 쓰는 값 그대로. 여기서 달라지면 이 검사는
# 거짓 안심이 된다 — 그래서 하드코딩하고 주석으로 짝을 밝혀 둔다.
PGHOST_="aws-1-us-east-1.pooler.supabase.com"
PGPORT_="5432"
PGDATABASE_="postgres"
PGUSER_="backup_reader.loovulhchmmwagtvjnhc"
R2_BUCKET_="kccp-attendance-backups"

pass=0; fail=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=$((fail+1)); }
note() { printf '    %s\n' "$1"; }

# 붙여넣은 값에 따라오는 것들을 떼어 낸다: 앞뒤 공백, 그리고 통째로 감싼 따옴표.
# `export R2_ENDPOINT='https://…'` 를 보고 값만 옮겨 적을 때 따옴표까지 딸려 오는 일이
# 실제로 많고, 그때 상류는 "엔드포인트가 이상하다"고만 말한다.
trim() {
  local v=$1
  v="${v#"${v%%[![:space:]]*}"}"; v="${v%"${v##*[![:space:]]}"}"
  case "$v" in
    "'"*"'"|'"'*'"') v="${v:1:${#v}-2}" ;;
  esac
  printf '%s' "$v"
}

ask() {  # ask VAR_NAME "물음" [secret]  — 비어 있고 터미널이면 물어본다
  [ -n "${!1:-}" ] && return 0
  [ -t 0 ] || return 0
  local value=""
  if [ "${3:-}" = secret ]; then
    printf '  %s: ' "$2"; read -rs value; echo
  else
    printf '  %s: ' "$2"; read -r value
    value=$(trim "$value")
  fi
  printf -v "$1" '%s' "$value"
  export "${1?}"
}

need() {  # need VAR_NAME "GitHub 시크릿 이름" "물음" [secret]
  ask "$1" "$3" "${4:-}"
  if [ -z "${!1:-}" ]; then
    bad "$1 이(가) 비어 있다 → GitHub 시크릿 $2"
    return 1
  fi
  # **예시를 그대로 붙여넣는 실수를 여기서 잡는다.** 이대로 흘려보내면 상류가
  # `malformed recipient "age1..."` 이나 `Invalid endpoint` 같은 말로 돌려주는데,
  # 그 문장은 "값이 틀렸다"가 아니라 "형식이 이상하다"로 읽혀서 **진짜 키를**
  # 의심하게 만든다. 실제로 그렇게 한 번 헤맸다.
  #
  # 비밀 값(비밀번호·시크릿 키)에는 **딱 맞는지만** 본다: 무작위 문자열에는
  # `<`·`>`·`...` 가 들어갈 수 있어서, 헐거운 규칙으로 걸면 진짜 값이 거부되고
  # 그 거부는 빠져나갈 길이 없다. 그리고 그 값은 **화면에 찍지 않는다.**
  if [ "${4:-}" = secret ]; then
    case "${!1}" in
      "..."|"backup_reader 비밀번호"|"여기에 붙여넣기"|"위 SQL 에 넣은 그 비밀번호"|"R2 토큰의 Secret Access Key")
        bad "$1 이(가) **예시 문자열 그대로**다 → 진짜 값으로 바꿔라 (GitHub 시크릿 $2)"
        return 1 ;;
    esac
    return 0
  fi
  case "${!1}" in
    *...*|*…*|*"<"*|*">"*|*여기에*|*실제*|*"R2 토큰의"*)
      bad "$1 이(가) **예시 문자열 그대로**다 → 진짜 값으로 바꿔라 (GitHub 시크릿 $2)"
      note "지금 값: ${!1}"
      return 1 ;;
  esac
  return 0
}

echo
echo "KCCP 백업 시크릿 사전 점검"
echo "──────────────────────────────────────────────"

# ── 1. DB ────────────────────────────────────────────────────────────────────────────
echo "1) Supabase 읽기 전용 접속  (SUPABASE_BACKUP_DB_PASSWORD)"
if need PGPASSWORD SUPABASE_BACKUP_DB_PASSWORD "backup_reader 비밀번호 (화면에 찍히지 않는다)" secret; then
  if ! command -v psql > /dev/null; then
    bad "psql 이 없다 — brew install libpq / apt install postgresql-client"
  else
    # 워크플로와 같은 방식: 비밀번호만 PGPASSWORD 로, 나머지는 따로 준다. URL 로 붙이면
    # 특수문자 이스케이프에서 틀리고, 그 실패는 "인증 실패" 로만 보인다.
    out=$(PGPASSWORD="$PGPASSWORD" psql \
            "host=$PGHOST_ port=$PGPORT_ dbname=$PGDATABASE_ user=$PGUSER_ sslmode=require connect_timeout=15" \
            -X -At -c "select current_user || ' / members=' || (select count(*) from public.members)" 2>&1)
    if [ $? -eq 0 ] && [ -n "$out" ]; then
      ok "접속 성공 — $out"
      # BYPASSRLS 가 없으면 행이 0으로 보이고, 그러면 "성공한 빈 백업"이 만들어진다.
      case "$out" in *"members=0") bad "행이 0이다 — backup_reader 에 BYPASSRLS 가 없을 수 있다";; esac
    else
      bad "접속 실패"
      note "$(echo "$out" | head -2)"
    fi
  fi
fi

# ── 2. age ───────────────────────────────────────────────────────────────────────────
echo
echo "2) age 암호화  (BACKUP_AGE_PUBLIC_KEY)"
if need BACKUP_AGE_PUBLIC_KEY BACKUP_AGE_PUBLIC_KEY "age 공개키 (age1 로 시작하는 한 줄)"; then
  if ! command -v age > /dev/null; then
    bad "age 가 없다 — brew install age / apt install age"
  else
    tmp=$(mktemp -d); echo "kccp-preflight" > "$tmp/plain"
    if age -r "$BACKUP_AGE_PUBLIC_KEY" -o "$tmp/enc" "$tmp/plain" 2>"$tmp/err"; then
      ok "공개키로 암호화된다"
      # **복호화까지 확인하는 것이 이 검사의 요점이다.** 암호화만 되는 것은 아무것도
      # 증명하지 않는다 — 정작 필요한 날이 개인키를 처음 써 보는 날이면 안 된다.
      # 그래서 경로를 묻되, 그냥 Enter 로 건너뛸 수 있게 둔다 (개인키는 **내용을
      # 읽지 않고** 경로로만 받는다).
      ask AGE_KEY_FILE "age 개인키 파일 경로 — 건너뛰려면 Enter"
      if [ -n "${AGE_KEY_FILE:-}" ]; then
        if [ ! -f "$AGE_KEY_FILE" ]; then
          bad "AGE_KEY_FILE 경로에 파일이 없다: $AGE_KEY_FILE"
        elif [ "$(age -d -i "$AGE_KEY_FILE" "$tmp/enc" 2>/dev/null)" = "kccp-preflight" ]; then
          ok "개인키로 다시 열린다 — 이 쌍은 진짜 맞는 쌍이다"
        else
          bad "개인키로 열리지 않는다 — 공개키와 개인키가 다른 쌍이다"
        fi
      else
        note "AGE_KEY_FILE 을 주면 복호화까지 확인한다 (권장)"
      fi
    else
      bad "암호화 실패 — 공개키 형식을 확인하라 (age1... 한 줄)"
      note "$(head -1 "$tmp/err")"
    fi
    rm -rf "$tmp"
  fi
fi

# ── 3. R2 ────────────────────────────────────────────────────────────────────────────
echo
echo "3) Cloudflare R2  (R2_ENDPOINT · R2_ACCESS_KEY_ID · R2_SECRET_ACCESS_KEY)"
r2_ready=0
need R2_ENDPOINT R2_ENDPOINT "R2 엔드포인트 (https://…r2.cloudflarestorage.com)" \
  && need AWS_ACCESS_KEY_ID R2_ACCESS_KEY_ID "R2 Access Key ID" \
  && need AWS_SECRET_ACCESS_KEY R2_SECRET_ACCESS_KEY "R2 Secret Access Key (화면에 찍히지 않는다)" secret \
  && r2_ready=1
if [ $r2_ready -eq 1 ]; then
  if ! command -v aws > /dev/null; then
    bad "aws CLI 가 없다 — brew install awscli / pip install awscli"
  else
    if aws --endpoint-url "$R2_ENDPOINT" s3 ls "s3://$R2_BUCKET_/" > /dev/null 2>"$PWD/.preflight-r2-err"; then
      ok "버킷 $R2_BUCKET_ 를 읽는다 (목록이 비어 있어도 정상 — 아직 백업이 없다)"
      # 워크플로의 정리 단계가 **지우기**까지 하므로 쓰기 권한을 여기서 확인한다.
      # Read 만 주면 업로드까지 가서야 실패한다.
      probe="s3://$R2_BUCKET_/.preflight-$(date +%s)"
      if echo ok | aws --endpoint-url "$R2_ENDPOINT" s3 cp - "$probe" > /dev/null 2>&1; then
        aws --endpoint-url "$R2_ENDPOINT" s3 rm "$probe" > /dev/null 2>&1 \
          && ok "쓰기·지우기 권한이 있다 (Object Read & Write)" \
          || bad "쓸 수는 있는데 지울 수 없다 — 정리 단계가 실패한다. 토큰을 Read & Write 로"
      else
        bad "쓰기 권한이 없다 — 토큰 권한을 Object Read & Write 로 만들어라"
      fi
    else
      bad "버킷을 읽지 못한다"
      note "$(head -2 "$PWD/.preflight-r2-err" 2>/dev/null)"
      note "엔드포인트가 https://<account-id>.r2.cloudflarestorage.com 모양인지,"
      note "토큰이 $R2_BUCKET_ 버킷에 묶여 있는지 확인하라."
    fi
    rm -f "$PWD/.preflight-r2-err"
  fi
fi

# ── 정리 ─────────────────────────────────────────────────────────────────────────────
echo
echo "──────────────────────────────────────────────"
if [ $fail -eq 0 ]; then
  echo "통과 $pass · 실패 0 — 다섯 시크릿을 넣어도 된다:"
  echo
  echo "  SUPABASE_BACKUP_DB_PASSWORD   \$PGPASSWORD"
  echo "  BACKUP_AGE_PUBLIC_KEY         \$BACKUP_AGE_PUBLIC_KEY"
  echo "  R2_ENDPOINT                   \$R2_ENDPOINT"
  echo "  R2_ACCESS_KEY_ID              \$AWS_ACCESS_KEY_ID"
  echo "  R2_SECRET_ACCESS_KEY          \$AWS_SECRET_ACCESS_KEY"
  echo
  echo "  https://github.com/shrlak/kccp/settings/secrets/actions"
  exit 0
fi
printf '통과 %s · \033[31m실패 %s\033[0m — 위의 ✗ 를 고치고 다시 돌려라.\n' "$pass" "$fail"
exit 1
