-- Additive: 5-sharing rooms get their own type; DORM now means 6 or more.
ALTER TYPE "RoomType" ADD VALUE IF NOT EXISTS 'FIVE' BEFORE 'DORM';
