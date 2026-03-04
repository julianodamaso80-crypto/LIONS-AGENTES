-- =============================================
-- SANITIZATION JOBS TABLE
-- Document Sanitizer feature - stores job metadata
-- =============================================

CREATE TABLE IF NOT EXISTS sanitization_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id),

    -- Original file
    original_filename TEXT NOT NULL,
    original_file_path TEXT NOT NULL,
    original_file_size BIGINT NOT NULL,
    original_mime_type TEXT NOT NULL,

    -- Result
    sanitized_file_path TEXT,
    sanitized_file_size BIGINT,

    -- Status and progress
    status TEXT NOT NULL DEFAULT 'pending',
    progress INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,

    -- Processing metadata
    pages_count INTEGER,
    images_count INTEGER,
    tables_count INTEGER,
    processing_time_seconds REAL,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days')
);

-- RLS
ALTER TABLE sanitization_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_isolation_select"
    ON sanitization_jobs FOR SELECT
    USING (company_id = (auth.jwt() ->> 'company_id')::uuid);

CREATE POLICY "company_isolation_insert"
    ON sanitization_jobs FOR INSERT
    WITH CHECK (company_id = (auth.jwt() ->> 'company_id')::uuid);

CREATE POLICY "company_isolation_delete"
    ON sanitization_jobs FOR DELETE
    USING (company_id = (auth.jwt() ->> 'company_id')::uuid);

-- Indexes
CREATE INDEX idx_sanitization_jobs_company ON sanitization_jobs(company_id);
CREATE INDEX idx_sanitization_jobs_status ON sanitization_jobs(status);
CREATE INDEX idx_sanitization_jobs_expires ON sanitization_jobs(expires_at);
