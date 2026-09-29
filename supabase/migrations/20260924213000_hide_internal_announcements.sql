-- Keep tenant-specific release notes out of the global announcement feed.
-- Rows remain available to system administrators for audit purposes.
UPDATE public.app_announcements
SET is_active = false
WHERE version IN (
  '26.2.0', '26.3.0', '26.4.1', '26.4.2', '26.4.3',
  'v26.5.0', 'v26.5.1', 'v26.5.2', 'v26.5.3', '26.5.4'
)
AND is_active = true;

-- Keep the last general release in the changelog without resurfacing its popup.
UPDATE public.app_announcements
SET expires_at = now()
WHERE version = '26.4.0'
  AND is_active = true
  AND (expires_at IS NULL OR expires_at > now());
