import { Controller, Get, Header } from '@nestjs/common';
import { performanceQuery } from '@signaldesk/domain';
import type { z } from 'zod';
import { notFound, Public, Summary, ZQuery } from '../common/http.js';
import { PerformanceService } from '../performance/performance.service.js';
import { SettingsService } from '../settings/settings.service.js';

@Controller('public')
@Public()
export class PublicController {
  constructor(
    private readonly settings: SettingsService,
    private readonly performance: PerformanceService,
  ) {}

  @Get('info')
  @Header('Cache-Control', 'public, max-age=60')
  @Summary('Service description and disclosures. Contains no signals and no results.')
  async info() {
    const s = await this.settings.get();
    const gate = await this.performance.publicGate();
    return {
      serviceName: s.serviceName,
      serviceDescription: s.serviceDescription,
      legalEntityName: s.legalEntityName,
      regulatoryStatement: s.regulatoryStatement,
      riskDisclosure: s.riskDisclosure,
      privacyNotice: s.privacyNotice,
      supportContact: s.supportContact,
      supportWhatsapp: s.supportWhatsapp,
      supportEmail: s.supportEmail,
      publicResultsAvailable: gate.enabled,
      aboutBody: s.aboutBody,
      dataResetAt: s.dataResetAt?.toISOString() ?? null,
    };
  }

  @Get('performance')
  @Summary('Results. Returns 404 unless the compliance gate is open.')
  async results(@ZQuery(performanceQuery) query: z.infer<typeof performanceQuery>) {
    const gate = await this.performance.publicGate();
    if (!gate.enabled || !gate.approval) throw notFound();
    const results = await this.performance.publicResults(query);
    const settings = await this.settings.get();
    return {
      ...results,
      dataResetAt: settings.dataResetAt?.toISOString() ?? null,
      disclosures: {
        riskDisclosure: settings.riskDisclosure,
        regulatoryStatement: settings.regulatoryStatement,
        approval: {
          jurisdiction: gate.approval.jurisdiction,
          scope: gate.approval.scope,
          documentReference: gate.approval.documentReference,
          expiresAt: gate.approval.expiresAt.toISOString(),
        },
      },
    };
  }
}
