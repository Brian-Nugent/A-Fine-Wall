DELETE FROM `climb_sends`
WHERE `climb_kind` = 'demo'
  AND `climb_id` IN (
    'first-light',
    'barn-door-protocol',
    'quiet-feet',
    'static-bloom',
    'redline'
  );
