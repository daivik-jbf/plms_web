ALTER TABLE "lessons" ADD COLUMN "cover_file_id" uuid;--> statement-breakpoint
ALTER TABLE "topic_attachments" ADD COLUMN "cover_file_id" uuid;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "cover_file_id" uuid;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_cover_file_id_files_id_fk" FOREIGN KEY ("cover_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_attachments" ADD CONSTRAINT "topic_attachments_cover_file_id_files_id_fk" FOREIGN KEY ("cover_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_cover_file_id_files_id_fk" FOREIGN KEY ("cover_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;