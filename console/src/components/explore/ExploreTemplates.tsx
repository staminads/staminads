import { useState } from 'react'
import { Card, Button } from 'antd'
import { BreakdownModal } from './BreakdownModal'
import type { CustomDimensionLabels } from '../../types/workspace'
import type { Filter } from '../../types/analytics'

interface ExploreTemplate {
  title: string
  description: string
  dimensions: string[]
  filters?: Filter[]
}

const templates: ExploreTemplate[] = [
  {
    title: 'Custom report',
    description: 'Create a custom report with your own dimensions',
    dimensions: []
  },
  {
    title: 'UTM Campaigns',
    description: 'Compare TimeScore across traffic sources',
    dimensions: ['utm_source', 'utm_medium', 'utm_campaign', 'device']
  },
  {
    title: 'Channels',
    description: 'High-level channel performance view',
    dimensions: ['channel_group', 'channel', 'utm_campaign', 'device']
  },
  {
    title: 'Landing pages',
    description: 'Content quality analysis by traffic source',
    dimensions: ['landing_path', 'utm_source', 'device']
  },
  {
    title: 'Referral traffic',
    description: 'Understand referral quality',
    dimensions: ['referrer_domain', 'referrer_path', 'landing_path']
  },
  {
    title: 'Devices & Tech',
    description: 'Technical performance insights',
    dimensions: ['device', 'browser', 'os', 'connection_type']
  },
  {
    title: 'Time patterns',
    description: 'Best times for engagement',
    dimensions: ['day_of_week', 'hour', 'is_weekend']
  },
  {
    title: 'Not-mapped channels',
    description: 'Traffic not classified by filter rules',
    dimensions: ['referrer_domain', 'utm_source', 'utm_medium', 'utm_campaign'],
    filters: [{ dimension: 'channel', operator: 'equals', values: ['not-mapped'] }]
  }
]

interface ExploreTemplatesProps {
  onSelectTemplate: (dimensions: string[], filters?: Filter[]) => void
  customDimensionLabels?: CustomDimensionLabels | null
}

export function ExploreTemplates({
  onSelectTemplate,
  customDimensionLabels
}: ExploreTemplatesProps) {
  const [isCustomModalOpen, setIsCustomModalOpen] = useState(false)

  const handleTemplateClick = (template: ExploreTemplate) => {
    if (template.title === 'Custom report') {
      setIsCustomModalOpen(true)
    } else {
      onSelectTemplate(template.dimensions, template.filters)
    }
  }

  const handleCustomReportSubmit = (dimensions: string[]) => {
    setIsCustomModalOpen(false)
    onSelectTemplate(dimensions)
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {templates.map((template) => (
          <Card
            key={template.title}
            className="hover:shadow-md transition-shadow cursor-pointer"
            onClick={() => handleTemplateClick(template)}
            styles={{
              body: { padding: '16px', display: 'flex', flexDirection: 'column', height: '100%' }
            }}
          >
            <div className="flex-1">
              <h3 className="text-sm font-semibold m-0 mb-2">{template.title}</h3>
              <p className="text-sm text-gray-500 mb-4">{template.description}</p>
            </div>
            <Button
              type="primary"
              ghost
              block
              onClick={(e) => {
                e.stopPropagation()
                handleTemplateClick(template)
              }}
            >
              {template.title === 'Custom report' ? 'Create my own' : 'Select'}
            </Button>
          </Card>
        ))}
      </div>

      <BreakdownModal
        open={isCustomModalOpen}
        onCancel={() => setIsCustomModalOpen(false)}
        onSubmit={handleCustomReportSubmit}
        customDimensionLabels={customDimensionLabels}
        title="Create Custom Report"
        submitText="Generate Report"
      />
    </>
  )
}
