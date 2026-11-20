import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GithubController } from './github.controller';
import { GithubService } from './github.service';
import { GithubToolsService } from './tools/github.tools';
import {
  GithubAccount,
  GithubAccountSchema,
} from './schemas/github-account.schema';
import {
  GithubCodeChunk,
  GithubCodeChunkSchema,
} from './schemas/github-code-chunk.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: GithubAccount.name, schema: GithubAccountSchema },
      { name: GithubCodeChunk.name, schema: GithubCodeChunkSchema },
    ]),
  ],
  controllers: [GithubController],
  providers: [GithubService, GithubToolsService],
  exports: [GithubService, GithubToolsService],
})
export class GithubModule {}
