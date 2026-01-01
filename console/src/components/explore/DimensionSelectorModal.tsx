import { useState, useMemo } from 'react'
import { Modal, Button, Tag, Empty, Input, Checkbox, message } from 'antd'
import { SearchOutlined, CloseOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { analyticsDimensionsQueryOptions } from '../../lib/queries'
import { groupDimensionsByCategory, getDimensionLabel } from '../../lib/explore-utils'
import type { DimensionInfo } from '../../types/explore'
import type { CustomDimensionLabels } from '../../types/workspace'

interface DimensionSelectorModalProps {
  open: boolean
  onCancel: () => void
  onSubmit: (dimensions: string[]) => void
  customDimensionLabels?: CustomDimensionLabels | null
}

export function DimensionSelectorModal({
  open,
  onCancel,
  onSubmit,
  customDimensionLabels,
}: DimensionSelectorModalProps) {
  const [selectedDimensions, setSelectedDimensions] = useState<string[]>([])
  const [searchTerm, setSearchTerm] = useState('')
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
          searchTerm === '' ||
          getDimensionLabel(dim.name, customDimensionLabels).toLowerCase().includes(searchTerm.toLowerCase()) ||
          category.toLowerCase().includes(searchTerm.toLowerCase()),
      )
      if (dims && dims.length > 0) {
        result[category] = dims
      }
    }
    return result
  }, [dimensionsByCategory, searchTerm, customDimensionLabels])

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
    setSelectedDimensions([])
    setSearchTerm('')
  }

  const handleCancel = () => {
    setSelectedDimensions([])
    setSearchTerm('')
    onCancel()
  }

  return (
    <Modal
      title="Create Custom Report"
      open={open}
      onCancel={handleCancel}
      width={800}
      footer={[
        <Button key="cancel" onClick={handleCancel}>
          Cancel
        </Button>,
        <Button key="submit" type="primary" onClick={handleSubmit} disabled={selectedDimensions.length === 0}>
          Generate Report
        </Button>,
      ]}
    >
      <div className="py-4">
        {selectedDimensions.length > 0 && (
          <div className="mb-4 p-3 bg-gray-50 rounded-lg">
            <div className="text-xs font-medium text-gray-500 mb-2">Selected dimensions (in order):</div>
            <div className="flex flex-wrap gap-1">
              {selectedDimensions.map((dim, index) => (
                <Tag
                  key={dim}
                  color="blue"
                  closable
                  onClose={() => handleRemoveDimension(dim)}
                  closeIcon={<CloseOutlined className="text-xs" />}
                >
                  {index + 1}. {getDimensionLabel(dim, customDimensionLabels)}
                </Tag>
              ))}
            </div>
          </div>
        )}

        <div className="mb-4">
          <Input
            placeholder="Search dimensions..."
            prefix={<SearchOutlined className="text-gray-400" />}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            allowClear
          />
        </div>

        <div className="max-h-96 overflow-y-auto border border-gray-200 rounded-lg">
          {Object.keys(filteredByCategory).length === 0 ? (
            <div className="p-8">
              <Empty description="No dimensions found" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4">
                {Object.entries(filteredByCategory).map(([category, dims]) => {
                  // Skip Geo (grouped with Channel) and Custom (rendered separately below)
                  if (category === 'Geo' || category === 'Custom') return null

                  const geoDims = category === 'Channel' ? filteredByCategory['Geo'] : null

                  return (
                    <div key={category} className="p-3">
                      <div className="text-xs font-semibold text-[var(--primary)] uppercase mb-2">
                        {category}
                      </div>
                      <div className="space-y-1">
                        {dims.map((dim) => (
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
                      {geoDims && geoDims.length > 0 && (
                        <>
                          <div className="text-xs font-semibold text-[var(--primary)] uppercase mb-2 mt-4">
                            Geo
                          </div>
                          <div className="space-y-1">
                            {geoDims.map((dim) => (
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
                    </div>
                  )
                })}
              </div>
              {filteredByCategory['Custom'] && filteredByCategory['Custom'].length > 0 && (
                <div className="p-3 border-t border-gray-100">
                  <div className="text-xs font-semibold text-[var(--primary)] uppercase mb-2">
                    Custom Dimensions
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4">
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
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
