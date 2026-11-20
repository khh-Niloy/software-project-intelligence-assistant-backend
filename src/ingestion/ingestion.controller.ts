import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IngestionService } from './ingestion.service';
import { multerOptions } from '../document/config/multer.config';
import { IngestRepoDto } from '../github/dto/ingest-repo.dto';

@Controller('ingest')
export class IngestionController {
  constructor(private readonly ingestionService: IngestionService) {}

  /**
   * Document Ingestion endpoint
   * POST /ingest/doc
   */
  @Post('doc')
  @UseInterceptors(FileInterceptor('file', multerOptions))
  async ingestDocument(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    return this.ingestionService.ingestDocument(file);
  }

  /**
   * Repository Code-Aware Ingestion endpoint
   * POST /ingest/repo
   */
  @Post('repo')
  async ingestRepository(@Body() dto: IngestRepoDto) {
    return this.ingestionService.ingestRepository(dto);
  }
}
