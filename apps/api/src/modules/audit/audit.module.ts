import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditService } from './application/audit.service';
import { AUDIT_REPOSITORY } from './application/ports';
import { AuditController } from './http/audit.controller';
import { AuditInterceptor } from './http/audit.interceptor';
import { DrizzleAuditRepository } from './infrastructure/audit.repository';

@Module({
  controllers: [AuditController],
  providers: [
    { provide: AUDIT_REPOSITORY, useClass: DrizzleAuditRepository },
    AuditService,
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  exports: [AuditService],
})
export class AuditModule {}
