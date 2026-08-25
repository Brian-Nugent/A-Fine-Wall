UPDATE `climbs` AS `current`
SET `setter` = (
  SELECT `canonical`.`name`
  FROM `profiles` AS `canonical`
  WHERE `canonical`.`name` = `current`.`setter` COLLATE NOCASE
  ORDER BY `canonical`.`created_at` ASC, `canonical`.`id` ASC
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1
  FROM `profiles` AS `matching`
  WHERE `matching`.`name` = `current`.`setter` COLLATE NOCASE
);
--> statement-breakpoint
INSERT INTO `climb_sends`
  (`climb_kind`, `climb_id`, `profile_id`, `rating`, `sent_at`, `updated_at`)
SELECT
  `send`.`climb_kind`,
  `send`.`climb_id`,
  `canonical`.`id`,
  `send`.`rating`,
  `send`.`sent_at`,
  `send`.`updated_at`
FROM `climb_sends` AS `send`
JOIN `profiles` AS `source` ON `source`.`id` = `send`.`profile_id`
JOIN `profiles` AS `canonical` ON `canonical`.`id` = (
  SELECT `candidate`.`id`
  FROM `profiles` AS `candidate`
  WHERE `candidate`.`name` = `source`.`name` COLLATE NOCASE
  ORDER BY `candidate`.`created_at` ASC, `candidate`.`id` ASC
  LIMIT 1
)
WHERE `send`.`profile_id` <> `canonical`.`id`
ON CONFLICT (`climb_kind`, `climb_id`, `profile_id`) DO UPDATE SET
  `rating` = CASE
    WHEN `excluded`.`updated_at` >= `climb_sends`.`updated_at`
      THEN `excluded`.`rating`
    ELSE `climb_sends`.`rating`
  END,
  `sent_at` = MIN(`climb_sends`.`sent_at`, `excluded`.`sent_at`),
  `updated_at` = MAX(`climb_sends`.`updated_at`, `excluded`.`updated_at`);
--> statement-breakpoint
DELETE FROM `climb_sends`
WHERE `profile_id` IN (
  SELECT `duplicate`.`id`
  FROM `profiles` AS `duplicate`
  WHERE EXISTS (
    SELECT 1
    FROM `profiles` AS `earlier`
    WHERE `earlier`.`name` = `duplicate`.`name` COLLATE NOCASE
      AND (
        `earlier`.`created_at` < `duplicate`.`created_at` OR
        (
          `earlier`.`created_at` = `duplicate`.`created_at` AND
          `earlier`.`id` < `duplicate`.`id`
        )
      )
  )
);
--> statement-breakpoint
CREATE INDEX `idx_profiles_name_nocase`
ON `profiles` ("name" COLLATE NOCASE);
