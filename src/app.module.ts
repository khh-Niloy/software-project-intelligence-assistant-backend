import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DocumentModule } from './document/document.module';
import { DatabaseModule } from './database/database.module';
import { ChatModule } from './chat/chat.module';
import { GithubModule } from './github/github.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { RetrievalModule } from './retrieval/retrieval.module';
import databaseConfig from './config/database.config';
import supabaseConfig from './config/supabase.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, supabaseConfig],
    }),
    DocumentModule,
    DatabaseModule,
    ChatModule,
    GithubModule,
    IngestionModule,
    RetrievalModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
