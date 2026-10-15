-- Data only: rooms with exactly 5 beds were stored as DORM before 5 sharing existed.
UPDATE "Room" SET "type" = 'FIVE' WHERE "type" = 'DORM' AND "capacity" = 5;
