-- Migration: Add 'csv' to ingestion_strategy CHECK constraint
-- Date: 2026-02-20
-- Reason: Support CSV table chunking strategy for CSV file uploads

ALTER TABLE documents DROP CONSTRAINT check_ingestion_strategy;

ALTER TABLE documents ADD CONSTRAINT check_ingestion_strategy 
  CHECK (ingestion_strategy::text = ANY (ARRAY[
    'recursive'::text, 
    'semantic'::text, 
    'page'::text, 
    'agentic'::text, 
    'csv'::text
  ]));
