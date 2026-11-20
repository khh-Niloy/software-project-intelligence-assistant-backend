import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';
import { Document, DocumentSchema } from '../document/schemas/document.schema';
import {
  DocumentChunk,
  DocumentChunkSchema,
} from '../document/schemas/document-chunk.schema';
import {
  GithubAccount,
  GithubAccountSchema,
} from '../github/schemas/github-account.schema';
import {
  GithubCodeChunk,
  GithubCodeChunkSchema,
} from '../github/schemas/github-code-chunk.schema';
import { SupabaseModule } from '../supabase/supabase.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Document.name, schema: DocumentSchema },
      { name: DocumentChunk.name, schema: DocumentChunkSchema },
      { name: GithubAccount.name, schema: GithubAccountSchema },
      { name: GithubCodeChunk.name, schema: GithubCodeChunkSchema },
    ]),
    SupabaseModule,
  ],
  controllers: [IngestionController],
  providers: [IngestionService],
  exports: [IngestionService],
})
export class IngestionModule {}
