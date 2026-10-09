ALTER TYPE "public"."file_purpose" ADD VALUE 'audio';--> statement-breakpoint
ALTER TABLE "media_items" RENAME COLUMN "video_file_id" TO "media_file_id";--> statement-breakpoint
ALTER TABLE "media_items" RENAME CONSTRAINT "media_items_video_file_id_files_id_fk" TO "media_items_media_file_id_files_id_fk";--> statement-breakpoint
ALTER INDEX "media_items_video_file_unique" RENAME TO "media_items_media_file_unique";
