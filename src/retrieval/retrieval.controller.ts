import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { RetrieveDocDto } from './dto/retrieve-doc.dto';
import { RetrieveRepoDto } from './dto/retrieve-repo.dto';
import { RetrievalService } from './retrieval.service';

@Controller('retrieve')
export class RetrievalController {
  constructor(private readonly retrievalService: RetrievalService) {}

  @Post('doc')
  retrieveDocument(@Body() body: RetrieveDocDto) {
    return this.retrievalService.retrieveDocument(body);
  }

  @Post('repo')
  retrieveRepository(@Body() body: RetrieveRepoDto) {
    return this.retrievalService.retrieveRepository(body);
  }

  @Get('repo/qna')
  getRepositoryQnas(@Query('repoName') repoName?: string) {
    return this.retrievalService.getRepositoryQnas(repoName);
  }

  @Get('repo/qna/:id')
  getRepositoryQnaById(@Param('id') id: string) {
    return this.retrievalService.getRepositoryQnaById(id);
  }
}
