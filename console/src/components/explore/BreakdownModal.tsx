import { useState, useMemo } from 'react'
import { Modal, Button, Tag, Empty, Checkbox, message, Row, Col } from 'antd'
import { CloseOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { analyticsDimensionsQueryOptions } from '../../lib/queries'
import { groupDimensionsByCategory, getDimensionLabel } from '../../lib/explore-utils'
import type { DimensionInfo } from '../../types/explore'
import type { CustomDimensionLabels } from '../../types/workspace'

interface BreakdownModalProps {
  open: boolean
  onCancel: () => void
  onSubmit: (dimensions: string[]) => void
  excludeDimensions?: string[]
  initialDimensions?: string[]
  customDimensionLabels?: CustomDimensionLabels | null
  title?: string
  submitText?: string
}

export function BreakdownModal({
  open,
  onCancel,
  onSubmit,
  excludeDimensions = [],
  initialDimensions = [],
  customDimensionLabels,
  title = 'Breakdown by',
  submitText = 'View Breakdown',
}: BreakdownModalProps) {
  const [selectedDimensions, setSelectedDimensions] = useState<string[]>(initialDimensions)
  const { data: dimensionsData } = useQuery(analyticsDimensionsQueryOptions)

  const dimensionsByCategory = useMemo(() => {
    if (!dimensionsData) return {}
    return groupDimensionsByCategory(dimensionsData as Record<string, DimensionInfo>)
  }, [dimensionsData])

  const filteredByCategory = useMemo(() => {
    const categoryOrder = ['UTM', 'Traffic', 'Channel', 'Geo', 'Pages', 'Device', 'Time', 'Custom']
    const sortedCategories = Object.keys(dimensionsByCategory).sort((a, b) => {
      const aIndex = categoryOrder.indexOf(a)
      const bIndex = categoryOrder.indexOf(b)
      if (aIndex === -1 && bIndex === -1) return a.localeCompare(b)
      if (aIndex === -1) return 1
      if (bIndex === -1) return -1
      return aIndex - bIndex
    })

    const result: Record<string, Array<{ name: string; type: string; category: string }>> = {}
    for (const category of sortedCategories) {
      const dims = dimensionsByCategory[category]?.filter(
        (dim) =>
          // Exclude dimensions that are already used in parent context
          !excludeDimensions.includes(dim.name),
      )
      if (dims && dims.length > 0) {
        result[category] = dims
      }
    }
    return result
  }, [dimensionsByCategory, excludeDimensions])

  const handleToggleDimension = (dimension: string) => {
    setSelectedDimensions((prev) =>
      prev.includes(dimension) ? prev.filter((d) => d !== dimension) : [...prev, dimension],
    )
  }

  const handleRemoveDimension = (dimension: string) => {
    setSelectedDimensions((prev) => prev.filter((d) => d !== dimension))
  }

  const handleSubmit = () => {
    if (selectedDimensions.length === 0) {
      message.error('Please select at least one dimension')
      return
    }
    onSubmit(selectedDimensions)
  }

  const handleCancel = () => {
    setSelectedDimensions(initialDimensions) // Reset for next open
    onCancel()
  }

  const handleAfterOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      setSelectedDimensions(initialDimensions)
    }
  }

  return (
    <Modal
      title={title}
      open={open}
      onCancel={handleCancel}
      afterOpenChange={handleAfterOpenChange}
      width={1000}
      centered
      styles={{
        body: {
          height: 600,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
      footer={[
        <Button key="cancel" onClick={handleCancel}>
          Cancel
        </Button>,
        <Button key="submit" type="primary" onClick={handleSubmit} disabled={selectedDimensions.length === 0}>
          {submitText}
        </Button>,
      ]}
    >
      <div className="py-4 flex flex-col h-full">
        <div className="mb-4 p-3 bg-gray-50 rounded-lg flex items-center gap-2 flex-wrap min-h-[46px]">
          <span className="text-xs font-medium text-gray-500">Selected dimensions (in order):</span>
          {selectedDimensions.length === 0 ? (
            <span className="text-xs text-gray-400 italic">(select a dimension below)</span>
          ) : (
            selectedDimensions.map((dim, index) => (
              <Tag
                key={dim}
                color="blue"
                closable
                onClose={() => handleRemoveDimension(dim)}
                closeIcon={<CloseOutlined className="text-xs" />}
                className="m-0"
              >
                {index + 1}. {getDimensionLabel(dim, customDimensionLabels)}
              </Tag>
            ))
          )}
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden border border-gray-200 rounded-lg min-h-0">
          {Object.keys(filteredByCategory).length === 0 ? (
            <div className="p-8">
              <Empty description="No dimensions found" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            </div>
          ) : (
            <Row gutter={16} className="pt-3 pl-6">
              {/* Column 1: Channel (2) + UTM (5) + Traffic (4) = 11 */}
              <Col span={6} className="p-3">
                {filteredByCategory['Channel'] && (
                  <>
                    <div className="text-xs font-semibold text-[var(--primary)] uppercase mb-2">Channel</div>
                    <div className="space-y-1">
                      {filteredByCategory['Channel'].map((dim) => (
                        <div
                          key={dim.name}
                          className="flex items-center gap-3 py-1 hover:bg-gray-50 rounded cursor-pointer"
                          onClick={() => handleToggleDimension(dim.name)}
                        >
                          <Checkbox checked={selectedDimensions.includes(dim.name)} />
                          <span className="text-sm">{getDimensionLabel(dim.name, customDimensionLabels)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {filteredByCategory['UTM'] && (
                  <>
                    <div className="text-xs font-semibold text-[var(--primary)] uppercase mb-2 mt-4">UTM</div>
                    <div className="space-y-1">
                      {filteredByCategory['UTM'].map((dim) => (
                        <div
                          key={dim.name}
                          className="flex items-center gap-3 py-1 hover:bg-gray-50 rounded cursor-pointer"
                          onClick={() => handleToggleDimension(dim.name)}
                        >
                          <Checkbox checked={selectedDimensions.includes(dim.name)} />
                          <span className="text-sm">{getDimensionLabel(dim.name, customDimensionLabels)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {filteredByCategory['Traffic'] && (
                  <>
                    <div className="text-xs font-semibold text-[var(--primary)] uppercase mb-2 mt-4">Traffic</div>
                    <div className="space-y-1">
                      {filteredByCategory['Traffic'].map((dim) => (
                        <div
                          key={dim.name}
                          className="flex items-center gap-3 py-1 hover:bg-gray-50 rounded cursor-pointer"
                          onClick={() => handleToggleDimension(dim.name)}
                        >
                          <Checkbox checked={selectedDimensions.includes(dim.name)} />
                          <span className="text-sm">{getDimensionLabel(dim.name, customDimensionLabels)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </Col>

              {/* Column 2: Pages (5) + Time (7) = 12 */}
              <Col span={6} className="p-3">
                {filteredByCategory['Pages'] && (
                  <>
                    <div className="text-xs font-semibold text-[var(--primary)] uppercase mb-2">Pages</div>
                    <div className="space-y-1">
                      {filteredByCategory['Pages'].map((dim) => (
                        <div
                          key={dim.name}
                          className="flex items-center gap-3 py-1 hover:bg-gray-50 rounded cursor-pointer"
                          onClick={() => handleToggleDimension(dim.name)}
                        >
                          <Checkbox checked={selectedDimensions.includes(dim.name)} />
                          <span className="text-sm">{getDimensionLabel(dim.name, customDimensionLabels)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {filteredByCategory['Time'] && (
                  <>
                    <div className="text-xs font-semibold text-[var(--primary)] uppercase mb-2 mt-4">Time</div>
                    <div className="space-y-1">
                      {filteredByCategory['Time'].map((dim) => (
                        <div
                          key={dim.name}
                          className="flex items-center gap-3 py-1 hover:bg-gray-50 rounded cursor-pointer"
                          onClick={() => handleToggleDimension(dim.name)}
                        >
                          <Checkbox checked={selectedDimensions.includes(dim.name)} />
                          <span className="text-sm">{getDimensionLabel(dim.name, customDimensionLabels)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </Col>

              {/* Column 3: Geo (2) + Device (9) = 11 */}
              <Col span={6} className="p-3">
                {filteredByCategory['Geo'] && (
                  <>
                    <div className="text-xs font-semibold text-[var(--primary)] uppercase mb-2">Geo</div>
                    <div className="space-y-1">
                      {filteredByCategory['Geo'].map((dim) => (
                        <div
                          key={dim.name}
                          className="flex items-center gap-3 py-1 hover:bg-gray-50 rounded cursor-pointer"
                          onClick={() => handleToggleDimension(dim.name)}
                        >
                          <Checkbox checked={selectedDimensions.includes(dim.name)} />
                          <span className="text-sm">{getDimensionLabel(dim.name, customDimensionLabels)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {filteredByCategory['Device'] && (
                  <>
                    <div className="text-xs font-semibold text-[var(--primary)] uppercase mb-2 mt-4">Device</div>
                    <div className="space-y-1">
                      {filteredByCategory['Device'].map((dim) => (
                        <div
                          key={dim.name}
                          className="flex items-center gap-3 py-1 hover:bg-gray-50 rounded cursor-pointer"
                          onClick={() => handleToggleDimension(dim.name)}
                        >
                          <Checkbox checked={selectedDimensions.includes(dim.name)} />
                          <span className="text-sm">{getDimensionLabel(dim.name, customDimensionLabels)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </Col>

              {/* Column 4: Custom (10) = 10 */}
              <Col span={6} className="p-3">
                {filteredByCategory['Custom'] && (
                  <>
                    <div className="text-xs font-semibold text-[var(--primary)] uppercase mb-2">Custom Dimensions</div>
                    <div className="space-y-1">
                      {filteredByCategory['Custom'].map((dim) => (
                        <div
                          key={dim.name}
                          className="flex items-center gap-3 py-1 hover:bg-gray-50 rounded cursor-pointer"
                          onClick={() => handleToggleDimension(dim.name)}
                        >
                          <Checkbox checked={selectedDimensions.includes(dim.name)} />
                          <span className="text-sm">{getDimensionLabel(dim.name, customDimensionLabels)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </Col>
            </Row>
          )}
        </div>
      </div>
    </Modal>
  )
}
