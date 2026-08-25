import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const profiles = sqliteTable("profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at").notNull(),
});

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
