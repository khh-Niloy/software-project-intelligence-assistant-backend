export interface JwtPayload {
  sub: string;
  email: string;
  role: 'admin' | 'member';
  organizationId: string;
}

export interface RefreshTokenPayload {
  sub: string;
}
