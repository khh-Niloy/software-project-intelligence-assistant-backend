import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Document, DocumentSchema } from '../document/schemas/document.schema';
import {
  DocumentChunk,
  DocumentChunkSchema,
} from '../document/schemas/document-chunk.schema';
import {
  GithubCodeChunk,
  GithubCodeChunkSchema,
} from '../github/schemas/github-code-chunk.schema';
import { DocumentModule } from '../document/document.module';
import { Qna, QnaSchema } from '../chat/schemas/qna.schema';
import { RepoQna, RepoQnaSchema } from './schemas/repo-qna.schema';
import { RetrievalController } from './retrieval.controller';
import { RetrievalService } from './retrieval.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Document.name, schema: DocumentSchema },
      { name: DocumentChunk.name, schema: DocumentChunkSchema },
      { name: GithubCodeChunk.name, schema: GithubCodeChunkSchema },
      { name: Qna.name, schema: QnaSchema },
      { name: RepoQna.name, schema: RepoQnaSchema },
    ]),
    DocumentModule,
  ],
  controllers: [RetrievalController],
  providers: [RetrievalService],
})
export class RetrievalModule {}
