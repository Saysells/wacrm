'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { THEMES } from '@/lib/themes';
import { CURRENCIES } from '@/lib/currency';
import {
  countOf,
  joinEstado,
  tableroCards,
  whatsappEstado,
  type TableroCard,
} from '@/lib/settings/tablero';

import { SECTION_META, type SettingsSection } from './settings-sections';
import { SettingsChip, StatusDot } from './settings-chip';
import { ROLE_META } from './role-meta';

// ============================================================
// Tablero de Configuración (rediseño, sesión F2), prototipo `config()`:
// tarjetas `.hc.t` en tres columnas, cada una con el ícono en un cuadro
// de 46 px, el título de la sección y su estado corto de hoy
// ("Necesita reconexión", "3 miembros", …). El orden y los estados se
// deciden en `src/lib/settings/tablero.ts`; acá solo se piden los datos
// y se pinta.
// ============================================================

interface OverviewCounts {
  members: number | null;
  pendingInvites: number | null;
  templates: number | null;
  templatesPending: number | null;
  tags: number | null;
  customFields: number | null;
  quickReplies: number | null;
}

interface WhatsAppStatus {
  configured: boolean;
  connected: boolean;
}

export function SettingsOverview({
  onSelect,
}: {
  onSelect: (section: SettingsSection) => void;
}) {
  const { user, profile, accountId, accountRole, defaultCurrency, canManageMembers } =
    useAuth();
  const { mode, theme } = useTheme();
  const t = useTranslations('Settings.overview');
  const tRoles = useTranslations('Settings.roles');
  const tSections = useTranslations('Settings.sections');
  const tAppearance = useTranslations('Settings.appearance');

  const [counts, setCounts] = useState<OverviewCounts | null>(null);
  const [countsLoading, setCountsLoading] = useState(true);
  // WhatsApp status is tracked separately: its health check decrypts the
  // token and pings Meta, which is far slower than the cheap count
  // queries. Gating it independently keeps a slow/flaky Meta round-trip
  // from blanking the rest of the landing.
  const [whatsapp, setWhatsapp] = useState<WhatsAppStatus | null>(null);
  const [whatsappLoading, setWhatsappLoading] = useState(true);

  useEffect(() => {
    if (!user || !accountId) return;
    let cancelled = false;
    const supabase = createClient();
    const userId = user.id;
    const acctId = accountId;

    // Cheap counts — resolve fast, render immediately.
    (async () => {
      setCountsLoading(true);
      const [membersRes, invitesRes, templatesTotal, templatesPending, tagsRes, fieldsRes, qrRes] =
        await Promise.allSettled([
          fetch('/api/account/members', { cache: 'no-store' }).then((r) => r.json()),
          canManageMembers
            ? fetch('/api/account/invitations', { cache: 'no-store' }).then((r) =>
                r.json(),
              )
            : Promise.resolve(null),
          supabase
            .from('message_templates')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId),
          supabase
            .from('message_templates')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('status', 'PENDING'),
          supabase
            .from('tags')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId),
          supabase.from('custom_fields').select('id', { count: 'exact', head: true }),
          fetch('/api/quick-replies', { cache: 'no-store' }).then((r) => r.json()),
        ]);

      if (cancelled) return;

      const members =
        membersRes.status === 'fulfilled' && Array.isArray(membersRes.value?.members)
          ? membersRes.value.members.length
          : null;
      const pendingInvites =
        invitesRes.status === 'fulfilled' &&
        invitesRes.value &&
        Array.isArray(invitesRes.value.invitations)
          ? invitesRes.value.invitations.length
          : null;
      const quickReplies =
        qrRes.status === 'fulfilled' && Array.isArray(qrRes.value?.quick_replies)
          ? qrRes.value.quick_replies.length
          : null;

      setCounts({
        members,
        pendingInvites,
        templates: countOf(templatesTotal),
        templatesPending: countOf(templatesPending),
        tags: countOf(tagsRes),
        customFields: countOf(fieldsRes),
        quickReplies,
      });
      setCountsLoading(false);
    })();

    // WhatsApp connection status — slower, independent.
    (async () => {
      setWhatsappLoading(true);
      const [row, health] = await Promise.allSettled([
        supabase
          .from('whatsapp_config')
          .select('phone_number_id')
          .eq('account_id', acctId)
          .maybeSingle(),
        fetch('/api/whatsapp/config', { cache: 'no-store' }).then((r) => r.json()),
      ]);
      if (cancelled) return;
      setWhatsapp({
        configured: row.status === 'fulfilled' && !!row.value.data?.phone_number_id,
        connected: health.status === 'fulfilled' && !!health.value?.connected,
      });
      setWhatsappLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id, accountId, canManageMembers]);

  const roleMeta = accountRole ? ROLE_META[accountRole] : null;
  const RoleIcon = roleMeta?.icon;
  const currencyLabel =
    CURRENCIES.find((c) => c.code === defaultCurrency)?.label ?? defaultCurrency;
  const themeName = THEMES.find((th) => th.id === theme)?.name ?? theme;
  const waEstado = whatsappEstado(whatsapp);

  // Estado corto por tarjeta. Un count en `null` cae a un texto genérico,
  // así una consulta que falló nunca deja la tarjeta en blanco.
  const estado: Record<TableroCard, { loading: boolean; text: ReactNode }> = {
    whatsapp: {
      loading: whatsappLoading,
      text:
        waEstado === 'connected' ? (
          <>
            <StatusDot tone="ok" /> {t('connected')}
          </>
        ) : waEstado === 'needsReconnecting' ? (
          <>
            <StatusDot tone="muted" /> {t('needsReconnecting')}
          </>
        ) : (
          t('notSetup')
        ),
    },
    templates: {
      loading: countsLoading,
      text:
        counts?.templates == null
          ? t('manageTemplates')
          : joinEstado([
              t('templatesCount', { count: counts.templates }),
              counts.templatesPending
                ? t('pendingReview', { count: counts.templatesPending })
                : null,
            ]),
    },
    'quick-replies': {
      loading: countsLoading,
      text:
        counts?.quickReplies == null
          ? t('quickRepliesHint')
          : t('quickRepliesCount', { count: counts.quickReplies }),
    },
    fields: {
      loading: countsLoading,
      text:
        counts?.tags == null && counts?.customFields == null
          ? t('tagsAndFields')
          : joinEstado([
              t('tagsCount', { count: counts?.tags ?? 0 }),
              t('fieldsCount', { count: counts?.customFields ?? 0 }),
            ]),
    },
    members: {
      loading: countsLoading,
      text:
        counts?.members == null
          ? t('viewTeamMembers')
          : joinEstado([
              t('membersCount', { count: counts.members }),
              counts.pendingInvites
                ? t('pendingInvites', { count: counts.pendingInvites })
                : null,
            ]),
    },
    appearance: {
      loading: false,
      text: t('appearance', { mode: tAppearance(`modes.${mode}`), theme: themeName }),
    },
    profile: {
      loading: false,
      text: (
        <>
          {roleMeta && RoleIcon && accountRole ? (
            <SettingsChip variant={roleMeta.variant}>
              <RoleIcon />
              {tRoles(accountRole)}
            </SettingsChip>
          ) : null}
          <span className="truncate">{profile?.email || profile?.full_name || t('yourAccount')}</span>
        </>
      ),
    },
    security: { loading: false, text: t('securityHint') },
    deals: { loading: false, text: joinEstado([defaultCurrency, currencyLabel]) },
    api: { loading: false, text: t('apiHint') },
  };

  return (
    <section className="animate-in fade-in-50 duration-200">
      {/* Prototipo `.cfg`: tres columnas, tarjetas `.hc.t`. */}
      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
        {tableroCards(accountRole).map((card) => {
          const Icon = SECTION_META[card].icon;
          const { loading, text } = estado[card];
          return (
            <button
              key={card}
              type="button"
              onClick={() => onSelect(card)}
              className="flex items-center gap-3.5 rounded-[18px] border border-border bg-card p-[18px] text-left transition-[border-color,box-shadow] hover:border-[#B9C4D2] hover:shadow-card"
            >
              <span
                aria-hidden="true"
                className="grid size-[46px] shrink-0 place-items-center rounded-[13px] bg-[#5C7FA3] text-white"
              >
                <Icon className="size-[22px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-foreground">
                  {tSections(card)}
                </span>
                <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted-foreground">
                  {loading ? (
                    <>
                      <Loader2 className="size-3 animate-spin" /> {t('loading')}
                    </>
                  ) : (
                    text
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
