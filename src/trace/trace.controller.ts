import {
  Body,
  Delete,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { TraceService } from './trace.service';
import { ExtractRequirementsDto } from './dto/extract-requirements.dto';
import { ApproveTraceDto } from './dto/approve-trace.dto';

@Controller('trace')
export class TraceController {
  constructor(private readonly traceService: TraceService) {}

  /**
   * Extract software requirements/features from an uploaded file or existing document
   */
  @Post('extract')
  @UseInterceptors(FileInterceptor('file'))
  async extractRequirements(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: ExtractRequirementsDto,
  ) {
    return this.traceService.extractRequirements(file, body?.documentId);
  }

  /**
   * Final approval:
   * 1. Creates Project document with repoName.
   * 2. Evaluates requirements against repo's code chunks.
   * 3. Creates individual Requirement documents with evidence and implementationStatus.
   */
  @Post('approve')
  async approveRequirements(@Body() dto: ApproveTraceDto) {
    return this.traceService.approveRequirements(dto);
  }

  /**
   * List all projects with repoName and summary stats
   */
  @Get('projects')
  async getAllProjects() {
    return this.traceService.getAllProjects();
  }

  /** Delete a project and its associated requirements by project ID. */
  @Delete('projects/:id')
  async deleteProject(@Param('id') id: string) {
    return this.traceService.deleteProject(id);
  }

  /**
   * Get all requirement documents for a specific repository by repoName
   */
  @Get('requirements/:repoName')
  async getRequirementsByRepoName(@Param('repoName') repoName: string) {
    return this.traceService.getRequirementsByRepoName(repoName);
  }

  /** Delete one requirement by requirement ID. */
  @Delete('requirements/:id')
  async deleteRequirement(@Param('id') id: string) {
    return this.traceService.deleteRequirement(id);
  }
}
