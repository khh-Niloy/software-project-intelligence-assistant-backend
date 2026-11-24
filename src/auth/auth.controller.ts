import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { jwtConfig } from '../config/jwt.config';
import type { JwtConfig } from '../config/jwt.config';
import {
  getAuthCookieOptions,
  getClearCookieOptions,
  parseDurationToMs,
} from './utils/cookie.util';

@Controller()
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    @Inject(jwtConfig.KEY)
    private readonly config: JwtConfig,
  ) {}

  /**
   * Register a new user
   */
  @Post(['register', 'auth/register'])
  async register(@Body() registerDto: RegisterDto) {
    const user = await this.authService.register(registerDto);
    return {
      message: 'User registered successfully',
      user,
    };
  }

  /**
   * Login user and set HTTP-only cookies
   */
  @Post(['login', 'auth/login'])
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken, user } =
      await this.authService.login(loginDto);

    const accessMaxAge = parseDurationToMs(this.config.accessExpiresIn);
    const refreshMaxAge = parseDurationToMs(this.config.refreshExpiresIn);

    res.cookie('access_token', accessToken, getAuthCookieOptions(accessMaxAge));
    res.cookie(
      'refresh_token',
      refreshToken,
      getAuthCookieOptions(refreshMaxAge),
    );

    return {
      message: 'Login successful',
      user,
    };
  }

  /**
   * Logout user by clearing HTTP-only cookies
   */
  @Post(['logout', 'auth/logout'])
  @HttpCode(HttpStatus.OK)
  logout(@Res({ passthrough: true }) res: Response) {
    const clearOptions = getClearCookieOptions();
    res.clearCookie('access_token', clearOptions);
    res.clearCookie('refresh_token', clearOptions);

    return {
      message: 'Logged out successfully',
    };
  }
}
