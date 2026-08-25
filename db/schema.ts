import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const profiles = sqliteTable(
  "profiles",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_profiles_name_nocase").on(
      sql`${table.name} COLLATE NOCASE`,
    ),
  ],
);

export const wallConfiguration = sqliteTable("wall_configuration", {
  id: integer("id").primaryKey(),
  holdsJson: text("holds_json").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const climbs = sqliteTable(
  "climbs",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    grade: text("grade").notNull(),
    setter: text("setter").notNull(),
    createdAt: integer("created_at").notNull(),
    holdsJson: text("holds_json").notNull(),
  },
  (table) => [index("idx_climbs_created_at").on(table.createdAt)],
);

export const deletedClimbs = sqliteTable("deleted_climbs", {
  id: text("id").primaryKey(),
  deletedAt: integer("deleted_at").notNull(),
});

export const climbSends = sqliteTable(
  "climb_sends",
  {
    climbKind: text("climb_kind", { enum: ["demo", "saved"] }).notNull(),
    climbId: text("climb_id").notNull(),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(),
    sentAt: integer("sent_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.climbKind, table.climbId, table.profileId],
      name: "climb_sends_climb_profile_pk",
    }),
    check(
      "climb_sends_kind_check",
      sql`${table.climbKind} IN ('demo', 'saved')`,
    ),
    check(
      "climb_sends_rating_check",
      sql`${table.rating} IN (1, 2, 3, 4, 5)`,
    ),
    index("idx_climb_sends_profile_id").on(table.profileId),
  ],
);
