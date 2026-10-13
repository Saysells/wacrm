'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Loader2, FileText, ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';

// Chips de categoría: variantes del `Badge` del sistema y texto del
// catálogo (`Settings.templates.categories.*`), igual que en Plantillas.
const categoryVariant: Record<string, 'info' | 'selected' | 'warning'> = {
  Marketing: 'info',
  Utility: 'selected',
  Authentication: 'warning',
};

interface Step1Props {
  selectedTemplate: MessageTemplate | null;
  onSelect: (template: MessageTemplate) => void;
  onNext: () => void;
  onBack: () => void;
}

export function Step1ChooseTemplate({ selectedTemplate, onSelect, onNext, onBack }: Step1Props) {
  const t = useTranslations('Broadcasts.wizard');
  const tTemplates = useTranslations('Settings.templates');
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTemplates() {
      try {
        const supabase = createClient();
        // Only APPROVED templates can be sent via Meta — anything else
        // would 400 at broadcast time. Hide them rather than letting
        // the user pick a template that will fail.
        const { data, error: fetchError } = await supabase
          .from('message_templates')
          .select('*')
          .eq('status', 'APPROVED')
          .order('created_at', { ascending: false });

        if (fetchError) throw fetchError;
        setTemplates(data ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('chooseTemplate.errorLoad'));
      } finally {
        setLoading(false);
      }
    }

    fetchTemplates();
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-danger">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('chooseTemplate.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('chooseTemplate.subtitle')}
        </p>
      </div>

      {templates.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={t('chooseTemplate.noTemplates')}
          description={t('chooseTemplate.createFirst')}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => {
            const isSelected = selectedTemplate?.id === template.id;

            return (
              <button
                key={template.id}
                onClick={() => onSelect(template)}
                className={`flex flex-col gap-3 rounded-[14px] border p-4 text-left transition-colors ${
                  isSelected
                    ? 'border-primary bg-selected'
                    : 'border-border bg-card hover:bg-hover'
                }`}
              >
                <div className="flex items-start justify-between">
                  <h3 className="text-sm font-semibold text-foreground">{template.name}</h3>
                  <Badge variant={categoryVariant[template.category] ?? 'secondary'}>
                    {['Marketing', 'Utility', 'Authentication'].includes(template.category)
                      ? tTemplates(`categories.${template.category}`)
                      : template.category}
                  </Badge>
                </div>
                <p className="line-clamp-3 text-xs text-muted-foreground">{template.body_text}</p>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span>{template.language ?? 'en_US'}</span>
                  {/* Status is omitted on purpose — every template
                      shown here is already filtered to APPROVED,
                      so the chip carried no information. */}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button variant="outline" onClick={onBack}>
          {t('back')}
        </Button>
        <Button onClick={onNext} disabled={!selectedTemplate}>
          {t('next')}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
