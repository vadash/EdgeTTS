// Pipeline Module
// Export all pipeline-related functionality

export type {
  PipelineContext,
  PipelineProgress,
  ProgressCallback,
  IPipelineStep,
  IPipelineRunner,
} from './types';

export { BasePipelineStep } from './types';
export { PipelineRunner, createPipelineRunner } from './PipelineRunner';

// Step registry for plugin-like extensibility
export { StepRegistry, createStepRegistry, type StepFactory } from './StepRegistry';

// Declarative pipeline configuration
export {
  buildPipelineFromConfig,
  pipelineConfig,
  PipelineConfigBuilder,
  type PipelineConfig,
  type StepConfig,
} from './PipelineConfig';

// Default registry with built-in steps
export { createDefaultStepRegistry, StepNames, type StepName } from './DefaultStepRegistry';

// Pipeline builder
export { PipelineBuilder, createPipelineBuilder, type IPipelineBuilder, type PipelineBuilderOptions } from './PipelineBuilder';

// Steps will be exported here as they are created
export * from './steps';
