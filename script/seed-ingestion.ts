import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { GithubService } from '../src/github/github.service';

async function runSeedIngestion() {
  const logger = new Logger('SeedIngestion');
  logger.log('Initializing NestJS application context...');

  const app = await NestFactory.createApplicationContext(AppModule);

  try {
    const githubService = app.get(GithubService);

    // 1. Fetch authenticated user's repositories (already sorted most recent first)
    logger.log('Fetching most recent repositories from GitHub...');
    const repos = await githubService.getUserRepositories({
      visibility: 'all',
      per_page: 30,
      sort: 'updated',
    });

    const recentThreeRepos = repos.slice(0, 3);

    if (recentThreeRepos.length === 0) {
      logger.warn('No repositories found for the connected GitHub account.');
      return;
    }

    logger.log(
      `Found ${recentThreeRepos.length} recent repositories to ingest: ${recentThreeRepos
        .map((r) => r.name)
        .join(', ')}`,
    );

    // 2. Ingest each of the 3 most recent repositories sequentially
    for (let i = 0; i < recentThreeRepos.length; i++) {
      const repo = recentThreeRepos[i];
      logger.log(
        `[${i + 1}/${recentThreeRepos.length}] Starting ingestion for repo "${repo.name}"...`,
      );

      try {
        const result = await githubService.ingestRepository({
          repoName: repo.name,
        });

        logger.log(
          `[${i + 1}/${recentThreeRepos.length}] Completed "${result.repoName}" -> Files: ${result.totalFiles}, Chunks stored: ${result.totalChunks}`,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(
          `[${i + 1}/${recentThreeRepos.length}] Failed to ingest "${repo.name}": ${msg}`,
        );
      }
    }

    logger.log('Finished ingesting the 3 most recent repositories.');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Seed ingestion script failed: ${msg}`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void runSeedIngestion();
