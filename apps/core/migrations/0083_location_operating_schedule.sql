-- No hours are inferred for retained locations. Operators configure their actual schedule.
CREATE TABLE location_operating_schedule (
  location_id TEXT NOT NULL PRIMARY KEY REFERENCES fulfillment_location(id) ON DELETE RESTRICT,
  timezone TEXT NOT NULL CHECK(length(timezone)>0),
  definition_json TEXT NOT NULL CHECK(json_valid(definition_json) AND json_type(definition_json)='object'),
  updated_at INTEGER NOT NULL CHECK(updated_at BETWEEN -9007199254740991 AND 9007199254740991)
) STRICT;
