import { Controller, Get, Param } from '@nestjs/common';
import { DocumentService } from './document.service';

@Controller(['document', 'documents', ''])
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  @Get('document')
  async getAllDocuments() {
    return this.documentService.getAllDocuments();
  }

  @Get('document/:id')
  async getDocumentById(@Param('id') id: string) {
    return this.documentService.getDocumentById(id);
  }
}
