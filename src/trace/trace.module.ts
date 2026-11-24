import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TraceController } from './trace.controller';
import { TraceService } from './trace.service';
import { Project, ProjectSchema } from './schemas/project.schema';
import { Requirement, RequirementSchema } from './schemas/requirement.schema';
import { Document, DocumentSchema } from '../document/schemas/document.schema';
import {
  DocumentChunk,
  DocumentChunkSchema,
} from '../document/schemas/document-chunk.schema';
import {
  GithubCodeChunk,
  GithubCodeChunkSchema,
} from '../github/schemas/github-code-chunk.schema';
import { IngestionModule } from '../ingestion/ingestion.module';
import { DocumentModule } from '../document/document.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Project.name, schema: ProjectSchema },
      { name: Requirement.name, schema: RequirementSchema },
      { name: Document.name, schema: DocumentSchema },
      { name: DocumentChunk.name, schema: DocumentChunkSchema },
      { name: GithubCodeChunk.name, schema: GithubCodeChunkSchema },
    ]),
    IngestionModule,
    DocumentModule,
  ],
  controllers: [TraceController],
  providers: [TraceService],
  exports: [TraceService],
})
export class TraceModule {}
