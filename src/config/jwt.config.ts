import { registerAs } from '@nestjs/config';

export interface JwtConfig {
  accessSecret: string;
  accessExpiresIn: string;
  refreshSecret: string;
  refreshExpiresIn: string;
}

export const jwtConfig = registerAs('jwt', (): JwtConfig => ({
  accessSecret:
    process.env.JWT_ACCESS_SECRET ||
    'default-jwt-access-secret-change-in-production',
  accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  refreshSecret:
    process.env.JWT_REFRESH_SECRET ||
    'default-jwt-refresh-secret-change-in-production',
  refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
}));

export default jwtConfig;
