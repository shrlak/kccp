-- prod에만 있던 것을 저장소로 떠 온다 — 재해복구가 실제로 되게 하려고.
--
-- ── 왜 이 파일이 있는가 ───────────────────────────────────────────────────────────────
-- 저장소의 마이그레이션만으로 빈 데이터베이스를 세우고 prod와 견주어 보니, prod에만
-- 있는 것이 **컬럼 넷과 인덱스 열하나**였다. 나머지 표 스무 개는 컬럼 구성이 md5까지
-- 똑같았다.
--
-- 그것들은 엑셀에서 명단을 옮겨 오던 작업이 prod에 직접 남긴 자국이다 (prod의
-- schema_migrations 에는 `adult_new_family_spouse_members` · `new_member_since` ·
-- `new_member_since_row_creation` · `adult_blank_email_null` ·
-- `edu_dongsan_expires_next_day` · `newfamily_sheet_backfill` 여섯이 적혀 있는데,
-- **그 SQL 파일은 이 저장소 히스토리 어디에도 없다.**) 그 여섯을 되살릴 방법은 없으므로,
-- 그것들이 **남긴 결과**를 여기에 적는다.
--
-- ── 이것이 왜 급한가 ─────────────────────────────────────────────────────────────────
-- 백업의 복원 경로가 이 파일에 달려 있다. `scripts/backup/run-backup.sh`는
--
--   1. `pg_dump --data-only --column-inserts` 로 뜨고 (INSERT 가 컬럼을 **이름으로** 지목한다)
--   2. **저장소의 마이그레이션을 재생해서** 검증용 스키마를 세운 뒤
--   3. 그 덤프를 `--single-transaction -v ON_ERROR_STOP=1` 로 흘려 넣는다.
--
-- 그래서 저장소가 `new_member_since` 를 모르면 덤프의 INSERT 가 없는 컬럼을 지목하고,
-- 복원은 거기서 통째로 멈춘다. 백업이 초록으로 끝나 놓고 정작 필요한 날 안 열리는 것이
-- 가장 나쁜 실패이고, 이 파일이 그것을 막는다.
--
-- 지금 이 넷·열하나는 **prod에 이미 있다.** 그러므로 prod에서 이 파일은 아무것도 하지
-- 않는다 (전부 IF NOT EXISTS). 값을 하는 자리는 **빈 데이터베이스** — 복원 검증, PR 미리보기
-- 브랜치, 그리고 언젠가의 재해복구다.

-- ── 컬럼 넷 ──────────────────────────────────────────────────────────────────────────
-- 둘 다 date, nullable, 기본값 없음 — prod의 정의 그대로다. 두 부(部)에 똑같이 있다.

-- 새가족이 된 날. `registration_date`(교회에 등록한 날)와 다른 값이라 칸이 따로 있다 —
-- 옮겨 온 명단에서는 둘이 어긋나는 사람이 실제로 있다.
-- 값이 들어 있다: public 183명 중 86명, adult 315명 중 17명 (2026-09 기준).
ALTER TABLE public.members ADD COLUMN IF NOT EXISTS new_member_since date;
ALTER TABLE adult.members  ADD COLUMN IF NOT EXISTS new_member_since date;

-- 새가족 교육 동산이 유효한 날짜. 교육 동산 자체는 없앴지만
-- (`members.new_member_dongsan` · `config.new_member_dongsan_names` 와 같은 처리로)
-- **컬럼은 지우지 않는다**: 백업이 --column-inserts 라 컬럼을 지우면 그 이전 덤프의
-- INSERT 가 전부 깨지고, 읽는 코드가 없는 컬럼은 아무 데도 새지 않는다.
ALTER TABLE public.config ADD COLUMN IF NOT EXISTS edu_dongsan_date date;
ALTER TABLE adult.config  ADD COLUMN IF NOT EXISTS edu_dongsan_date date;

-- ── 인덱스 열하나 ────────────────────────────────────────────────────────────────────
-- 출석 조회의 뜨거운 길들이다. 이름이 두 스키마에서 다른 것은 손으로 만들어진 자국이라
-- **그대로 둔다** — 맞추려고 바꾸면 prod에서 인덱스가 하나 지워졌다 다시 생기고, 그
-- 사이에 /api/roster 가 느려진다. 이름은 성능에 아무 뜻이 없다.

-- 대학·청년부 (public) — `idx_` 접두사
CREATE INDEX IF NOT EXISTS idx_att_log_date      ON public.attendance_log (date);
CREATE INDEX IF NOT EXISTS idx_att_log_date_name ON public.attendance_log (date, name);
CREATE INDEX IF NOT EXISTS idx_att_log_device    ON public.attendance_log (device_id);
CREATE INDEX IF NOT EXISTS idx_att_log_name      ON public.attendance_log (name);
CREATE INDEX IF NOT EXISTS idx_devices_name      ON public.devices (name);

-- 장년부 (adult) — 접두사 없는 이름
CREATE INDEX IF NOT EXISTS attendance_log_date_idx       ON adult.attendance_log (date);
CREATE INDEX IF NOT EXISTS attendance_log_date_name_idx  ON adult.attendance_log (date, name);
CREATE INDEX IF NOT EXISTS attendance_log_device_id_idx  ON adult.attendance_log (device_id);
CREATE INDEX IF NOT EXISTS attendance_log_name_idx       ON adult.attendance_log (name);
CREATE INDEX IF NOT EXISTS devices_name_idx              ON adult.devices (name);

-- ── 제약 하나 ────────────────────────────────────────────────────────────────────────
-- 기기 하나가 대기 등록을 둘 가질 수 없다. prod에는 UNIQUE 제약으로 서 있으므로
-- 인덱스가 아니라 제약으로 만든다 — 인덱스로만 두면 모양은 같아 보여도
-- information_schema 가 다르게 답하고, 다음에 비교하는 사람이 또 같은 자리에서 멈춘다.
--
-- ADD CONSTRAINT 에는 IF NOT EXISTS 가 없어서 DO 블록으로 감싼다.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pending_registrations_device_id_key'
      AND conrelid = 'public.pending_registrations'::regclass
  ) THEN
    ALTER TABLE public.pending_registrations
      ADD CONSTRAINT pending_registrations_device_id_key UNIQUE (device_id);
  END IF;
END $$;
