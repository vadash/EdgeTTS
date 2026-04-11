Silei Xu, Wenhao Xie, Lingxiao Zhao, Pengcheng He  
Zoom Communications  

###### Abstract

Large Language Models (LLMs) have demonstrated remarkable performance in solving complex reasoning tasks through mechanisms like Chain-of-Thought (CoT) prompting, which emphasizes verbose, step-by-step reasoning. However, humans typically employ a more efficient strategy: drafting concise intermediate thoughts that capture only essential information. In this work, we propose Chain of Draft (CoD), a novel paradigm inspired by human cognitive processes, where LLMs generate minimalistic yet informative intermediate reasoning outputs while solving tasks. By reducing verbosity and focusing on critical insights, CoD matches or surpasses CoT in accuracy while using as little as only 7.6% of the tokens, significantly reducing cost and latency across various reasoning tasks. Our code and data are available at https://github.com/sileix/chain-of-draft.

Chain of Draft: Thinking Faster by Writing Less

Silei Xu††thanks: Correspondence to <silei.xu@zoom.us\>, Wenhao Xie, Lingxiao Zhao, Pengcheng He Zoom Communications

## 1 Introduction

Recent advances in reasoning models such as OpenAI o1 OpenAI (2024) and DeepSeek R1 Guo et al. (2025) have propelled large language models (LLMs) to unprecedented performance on complex tasks using techniques like Chain of Thought (CoT) Wei et al. (2022). This paradigm encourages models to break down problems into step-by-step explorations, mimicking the structured reasoning process of humans. While effective, this approach demands substantially more computational resources at inference time, leading to verbose outputs and higher latency. Such verbosity contrasts sharply with how humans typically approach problem-solving: we rely on concise drafts or shorthand notes to capture essential insights without unnecessary elaboration.

Motivated by this difference, we propose Chain of Draft (CoD), a novel prompting strategy that aligns more closely with human reasoning by prioritizing efficiency and minimalism. Instead of verbose intermediate steps, Chain of Draft encourages LLMs to generate concise, dense-information outputs at each step. This approach reduces latency and computational costs without sacrifice of accuracy, making LLMs more practical for real-world applications where efficiency is paramount.

Figure 1: Comparison of Claude 3.5 Sonnet’s accuracy and token usage across different tasks with three different prompt strategies: direct answer (Standard), Chain of Thought (CoT), and Chain of Draft (CoD). CoD achieves similar accuracy as CoT while using significant fewer tokens.

The intuition behind Chain of Draft is rooted in how humans externalize thought. When solving complex tasks — whether solving mathematical problems, drafting essays, or coding — we often jot down only the critical pieces of information that help us progress. By emulating this behavior, LLMs can focus on advancing toward solutions without the overhead of verbose reasoning.

To evaluate the effectiveness of Chain of Draft, we conducted experiments across a variety of benchmarks requiring multi-step reasoning, including arithmetic reasoning, common sense reasoning, and symbolic reasoning. Our results demonstrate that this minimalist approach maintains or even improves accuracy compared with standard Chain of Thought, while significantly reducing token usage and latency.

The contributions of this paper are threefold:

-   •
    
    We introduce Chain of Draft, a concise reasoning prompting strategy inspired by human cognitive processes.
    
-   •
    
    We empirically validate that Chain of Draft can achieve significantly reduced latency and cost without sacrificing accuracy.
    
-   •
    
    We discuss the implications of Chain of Draft for LLM design, deployment, and real-world usability.
    

## 2 Related Work

Structured Reasoning Frameworks for LLMs Recently, a variety of reasoning language models have emerged, including o1 by OpenAI OpenAI (2024), QwQ by Alibaba Team (2024), and R1 by DeepSeek Guo et al. (2025), demonstrating substantial improvements in tackling complex tasks. These models leverage structured reasoning methods to enhance robustness and problem-solving capabilities. The concept of Chain-of-Thought reasoning (CoT) Wei et al. (2022); Kojima et al. (2022), established a foundational approach to reasoning in LLMs. Building on this foundation, more sophisticated topologies have emerged, such as tree Yao et al. (2024); Chen et al. (2024a); Yu et al. (2023) and graph Besta et al. (2024); Lei et al. (2023); Jiang et al. (2023), enabling LLMs to address increasingly intricate problems.

Other enhancements include self-consistency CoT Wang et al. (2022), which incorporates verification and reflection mechanisms to bolster reasoning reliability, and ReAct Yao et al. (2022), which integrates tool usage into the reasoning process, allowing LLMs to access external resources and knowledge. These innovations collectively expand the reasoning capabilities of LLMs across a diverse range of applications.

LLM Inference Latency Reduction Although structured reasoning greatly enhances LLMs’ ability to solve complex questions, it significantly increases the token usage before arriving at a final answer. This makes it challenging to apply in cost-sensitive and latency-sensitive scenarios Wang et al. (2024). Furthermore, the model’s lack of awareness regarding task complexity often leads to overthinking Chen et al. (2024b); Chiang and Lee (2024) even on simple tasks, resulting in unnecessary resource consumption.

Techniques like streaming aim to reduce perceived latency by incrementally providing partial outputs as they are generated, rather than waiting for the entire output sequence. However, this approach cannot fully mitigate overall latency or computational cost, and it is often unsuitable for chain-of-thought reasoning, as intermediate steps are often not intended to be shown to end users.

Ning et al. (2023) proposes Skeleton-of-Thought (SoT), a method that first guides LLMs to generate a skeleton outline of the answer, followed by parallel decoding to reduce latency. While SoT helps lower latency, it does not reduce computational cost and is limited to questions that can be parallelized effectively. Zhang et al. (2023) took a different approach, it first generates draft tokens at lower quality but higher speed through selective skipping of intermediate layers, and then validates the draft in a single forward pass. Our approach, CoD, can be combined with these approaches to further reduce the latency.

Hao et al. (2024) proposes Coconut to train LLMs to perform reasoning in a continuous latent space rather than in the traditional natural language space using the final hidden state of the LLM to represent the reasoning process. While Coconut reduces latency and computational cost, it suffers from reduced accuracy in complex tasks, such as GSM8k. Additionally, it loses the interpretability of natural language reasoning and cannot be applied to black-box models like GPT and Claude.

The works closest to ours are Concise Thoughts (CCoT) Nayab et al. (2024) and token-budget-aware LLM reasoning (TALE) Han et al. (2024). CCoT proposes using a fixed global token budget for reasoning steps. However, different tasks may require varying budgets to achieve the optimal balance between performance and cost. Moreover, LLMs may fail to adhere to an impractical budget, often generating far more tokens than intended Han et al. (2024). Han et al. (2024) extends this idea by dynamically estimating a global token budget for different problems based on reasoning complexity. However, this approach requires an additional LLM call to estimate the budget, which increases latency. Furthermore, it assumes that the model can accurately predict the complexity of requests, limiting its applicability to more complex tasks where reflection, self-correction, or external knowledge retrieval may be necessary during the reasoning process. In contrast, our approach employs a per-step budget, allowing unlimited reasoning steps, which makes it more adaptable to various structured reasoning techniques.

## 3 Chain-of-Draft Prompting

The Chain-of-Thought (CoT) prompting strategy has demonstrated significant effectiveness across a wide range of tasks, particularly those requiring complex multi-step reasoning. However, LLMs often produce excessively verbose reasoning steps, consuming a substantial number of tokens before arriving at a final answer. In contrast, humans tend to adopt a more concise approach when solving complex problems involving multi-step reasoning, such as mathematical or logical puzzles. Rather than elaborating on every detail, humans typically jot down only the essential intermediate results — minimal drafts — to facilitate their thought processes. Inspired by this natural tendency, we propose a novel prompting strategy called Chain-of-Draft (CoD). This approach aims to reduce verbosity by limiting the number of words used in each reasoning step, focusing only on the essential calculations or transformations needed to progress.

To illustrate the difference between standard prompting, Chain-of-Thought prompting, and our proposed Chain-of-Draft prompting, consider the following simple arithmetic problem:

Q: Jason had 20 lollipops. He gave Denny some lollipops. Now Jason has 12 lollipops. How many lollipops did Jason give to Denny?

The response generated by a standard prompting approach directly outputs the answer, often without any reasoning. While correct, this lacks transparency in how the answer was derived, and requires the language model to run multi-step reasoning without any help from intermediate result, which often leads to hallucination.

Chain-of-Thought prompting, on the other hand, provides a detailed reasoning process. While this response is accurate and interpretable, it includes unnecessary details about Jason, Denny, and the lollipops, which are irrelevant to solving the mathematical problem. This verbosity inflates the token count and increases the response latency.

By contrast, Chain-of-Draft prompting condenses the reasoning process into minimal, abstract representations. Here, the reasoning is distilled into a concise equation, focusing solely on the essential mathematical operation required to arrive at the solution. By abstracting away irrelevant contextual details, CoD significantly reduces the token count while maintaining transparency and correctness.

## 4 Experiments

In empirical experiments, we follow the original CoT paper Wei et al. (2022) to evaluate on 3 categories of tasks: arithmetic reasoning, commonsense reasoning, and symbolic reasoning. We pick representative tasks where original CoT significantly improves the accuracy over the baseline without reasoning. In particular, we pick GSM8k Cobbe et al. (2021) for arithmetic reasoning; date understanding and sports understanding from BIG-bench bench authors (2023) for commonsense reasoning; and coin flip tasks introduced in the CoT paper Wei et al. (2022) for symbolic reasoning.

### 4.1 Experimental Setup

We compare three different prompt strategies: CoT, CoD, and Standard prompting as a baseline.

Standard prompting. we use standard few-shot prompting Brown et al. (2020), where the model is given input-output pairs as in-context examples. LLMs are asked to directly return the final answer, without any reasoning or explanation.

Chain-of-Thought. We follow the exact few-shot examples provided in the appendix of the CoT paper with the exception of having the final answer after four hashtags (####) for a more stable answer extraction.

Chain-of-Draft. In CoD, we also asked the model to think step by step. However, the model is asked to limit each reasoning step to five words at most. Note that we do not enforce such limitation in any way, it is just a general guideline to promte short reasoning steps. For each few-shot example, we also include the Chain of Draft written manually by the authors.

The complete system prompt for each prompting strategy is shown below.

We evaluated each task with two of the most popular flagship models: GPT-4o (gpt-4o-2024-08-06) from OpenAI and Claude 3.5 Sonnet (claude-3-5-sonnet-20240620) from Anthropic.

### 4.2 Arithmetic Reasoning

We first consider math problems that measure the arithmetic reasoning capabilities of LLMs. GSM8k Cobbe et al. (2021) has emerged as the benchmark of choice for evaluating arithmetic reasoning in language models, providing a comprehensive dataset of 8,500 diverse grade-school-level mathematical problems. Each problem is paired with a detailed step-by-step solution, emphasizing arithmetic, geometry, algebra, and logical reasoning skills.

The evaluation results are presented in Table 1. The dataset poses significant challenges for both GPT-4o and Claude 3.5 Sonnet when using standard prompting, yielding accuracies of 53.3% and 64.6%, respectively. However, with the application of the CoT, both models surpass 95% accuracy, albeit at the expense of generating approximately 200 tokens per response. In contrast, CoD achieves an accuracy of 91% for both models while requiring only about 40 tokens per response, thereby reducing the average output token count by 80% and cutting the average latency by 76.2% and 48.4%, respectively.

Table 1: GSM8K evaluation results.

### 4.3 Commonsense Reasoning

We evaluate the tasks of date understanding and sports understanding from BIG-bench to demonstrate the effectiveness of CoD in common sense reasoning. For consistency, we use the same system prompts as those employed in the arithmetic reasoning evaluation.

The evaluation results, presented in Table 2, show that CoD significantly reduces both latency and cost by generating considerably fewer tokens in responses compared to CoT. Additionally, CoD outperforms CoT in accuracy in various cases. Notably, chain-of-thought prompting leads to excessively verbose responses for Claude 3.5 Sonnet, especially in the sports understanding task, where CoD reduces the average output tokens from 189.4 to 14.3 — a 92.4% reduction.

Table 2: Date understanding evaluation results.

Table 3: Sports understanding evaluation results.

### 4.4 Symbolic Reasoning

The original CoT paper Wei et al. (2022) introduces the task of coin flipping, where the LLMs are asked to predict which side is up after a sequence of coin flip actions. Since the exact dataset is not published, we synthesize a test set of 250 examples following the same design. Specifically, we randomly chose 4 out of the top 1000 first names in the US region according to NameDataset Remy (2021) and randomly decided to flip the coin or not for each name. An example of the evaluation data is shown below.

The evaluation results for GPT-4o and Claude 3.5 Sonnet are shown in Table 4. They achieve 73.2% and 85.2% with standard prompting, respectively. However, both models reach a perfect 100% accuracy with CoT and CoD. Again, CoD demonstrates significant reduction of tokens compared to CoT, from 68% for GPT-4o to 86% for Claude 3.5 Sonnet.

Table 4: Coin flip evaluation results.

### 4.5 Limitaitons of CoD

Inconsistency Without Few-shot Examples

We evaluated the performance of CoD under zero-shot setting, where no few-shot examples were provided. The results, presented in Table 5, indicate a significant decline in CoD’s effectiveness. Notably, for Claude 3.5 Sonnet, CoD improved performance over direct answering by only 3.6%. Additionally, the token savings achieved by CoD are less significant compared to few-shot setting.

We hypothesize that this limitation arises due to the scarcity or absence of CoD-style reasoning patterns in the training data of large language models, making it a challenging task to generate concise and insightful “drafts” without guidance from few-shot examples.

Table 5: Zero-shot GSM8K evaluation results.

Reduced Performance on Small Models

We tested CoD on several small language models with fewer than 3B parameters, including Qwen2.5 1.5B/3B instruct Yang et al. (2024), Llama 3.2 3B instruct Dubey et al. (2024), and our in-house Zoom SLM 2.3B model Zoom (2025). While CoD effectively reduces the number of tokens required per response and improves accuracy over direct answer, its performance gap compared to CoT is more pronounced in these models.

Similar to the zero-shot setting, we suspect this is due to the absence of CoD-style data in the training process. We anticipate that fine-tuning these models with additional CoD-formatted data could significantly enhance their reasoning accuracy with CoD.

Table 6: GSM8K evaluation results on small language models.

## 5 Discussion

The latency issue has often been overlooked in studies of the reasoning capabilities of LLMs. However, it is crucial for lots of real-time applications to have low latency while maintaining high-quality responses. In this work, we propose Chain of Draft (CoD), a novel approach that substantially reduces the latency required for reasoning while achieving comparable or even superior accuracy compared to standard Chain-of-Thought prompting strategies. Unlike traditional methods that often involve lengthy reasoning steps, CoD leverages concise reasoning drafts to speed up response generation without sacrificing correctness.

Additionally, CoD offers significant cost advantages. By compacting the reasoning steps, it reduces the number of input tokens required for few-shot prompting and shortens the output token length, directly lowering computational cost. This token efficiency makes CoD especially appealing in cost-sensitive scenarios, such as large-scale deployments of LLMs or applications with strict budget constraints.

CoD demonstrates that effective reasoning in LLMs does not necessarily require lengthy outputs, offering an alternative approach where reasoning depth is maintained with minimal verbosity. Future work could explore combining CoD with other latency-reducing methods, such as adaptive parallel reasoning or multi-pass validation, to further optimize performance across different application domains. In addition, the principles behind the compact reasoning of CoD could inspire new strategies to improve reasoning models by training with compact reasoning data, while maintaining interpretability and efficiency in LLMs, helping bridge the gap between research-driven improvements in reasoning and the practical demands of real world systems.
