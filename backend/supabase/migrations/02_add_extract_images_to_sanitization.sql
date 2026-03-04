-- Migration: Add extract_images flag to sanitization_jobs
-- Date: 2026-02-20
-- Reason: Support opt-in/opt-out for Vision API image analysis during sanitization

ALTER TABLE sanitization_jobs
ADD COLUMN extract_images BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN sanitization_jobs.extract_images IS 'Se true, ativa Vision API para descrever imagens durante a sanitização';
