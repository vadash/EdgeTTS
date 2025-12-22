# Use XML tags to structure your prompts

---

<Note>
While these tips apply broadly to all Claude models, you can find prompting tips specific to extended thinking models [here](/docs/en/build-with-claude/prompt-engineering/extended-thinking-tips).
</Note>

When your prompts involve multiple components like context, instructions, and examples, XML tags can be a game-changer. They help Claude parse your prompts more accurately, leading to higher-quality outputs.

<Tip>**XML tip**: Use tags like `<instructions>`, `<example>`, and `<formatting>` to clearly separate different parts of your prompt. This prevents Claude from mixing up instructions with examples or context.</Tip>

## Why use XML tags?

- **Clarity:** Clearly separate different parts of your prompt and ensure your prompt is well structured.
- **Accuracy:** Reduce errors caused by Claude misinterpreting parts of your prompt.
- **Flexibility:** Easily find, add, remove, or modify parts of your prompt without rewriting everything.
- **Parseability:** Having Claude use XML tags in its output makes it easier to extract specific parts of its response by post-processing.

<Note>There are no canonical "best" XML tags that Claude has been trained with in particular, although we recommend that your tag names make sense with the information they surround.</Note>

***

## Tagging best practices

1. **Be consistent**: Use the same tag names throughout your prompts, and refer to those tag names when talking about the content (e.g, `Using the contract in <contract> tags...`).
2. **Nest tags**: You should nest tags `<outer><inner></inner></outer>` for hierarchical content.

<Tip>**Power user tip**: Combine XML tags with other techniques like multishot prompting (`<examples>`) or chain of thought (`<thinking>`, `<answer>`). This creates super-structured, high-performance prompts.</Tip>

### Examples

  <section title="Example: Generating financial reports">

    Without XML tags, Claude misunderstands the task and generates a report that doesn't match the required structure or tone. After substitution, there is also a chance that Claude misunderstands where one section (like the the Q1 report example) stops and another begins.

    | Role | No XML Tags | With XML Tags |
    | ---- | ----------- | ------------- |
    | User | You're a financial analyst at AcmeCorp. Generate a Q2 financial report for our investors. Include sections on Revenue Growth, Profit Margins, and Cash Flow, like with this example from last year: \{\{Q1_REPORT\}\}. Use data points from this spreadsheet: \{\{SPREADSHEET_DATA\}\}. The report should be extremely concise, to the point, professional, and in list format. It should and highlight both strengths and areas for improvement. | You're a financial analyst at AcmeCorp. Generate a Q2 financial report for our investors.<br/><br/>AcmeCorp is a B2B SaaS company. Our investors value transparency and actionable insights.<br/><br/>Use this data for your report:\<data>\{\{SPREADSHEET_DATA\}\}\</data><br/><br/>\<instructions><br/>1. Include sections: Revenue Growth, Profit Margins, Cash Flow.<br/>2. Highlight strengths and areas for improvement.<br/>\</instructions><br/><br/>Make your tone concise and professional. Follow this structure:<br/>\<formatting_example>\{\{Q1_REPORT\}\}\</formatting_example> |
    | Assistant | Q2 Financial Report for AcmeCorp Investors<br/><br/>Dear Valued Investors,<br/><br/>I am pleased to present our Q2 financial report, showcasing AcmeCorp's continued growth and resilience in the B2B SaaS market.<br/><br/>1. Revenue Growth:<br/>Our Q2 revenue reached \$15.2M, a 22% YoY increase. This growth is primarily driven by a 30% expansion in our enterprise client base. However, our SMB segment saw a slight decline of 5%, which we aim to address through targeted marketing initiatives in Q3.<br/><br/>2. Profit Margins:<br/>Gross margin improved to 72% (up 3% from Q1) due to infrastructure optimizations. EBITDA margin, however, dipped to 18% (down 2%) as we invested heavily in R&D for our upcoming AI-driven features.<br/><br/>3. Cash Flow:<br/>Operating cash flow remains strong at \$4.1M. Our cash reserves stand at \$28M, providing a 15-month runway at current burn rate. We did see a 20% increase in customer acquisition costs, which we're addressing through more efficient sales strategies.<br/><br/>In summary, AcmeCorp's core financials remain robust. We're balancing growth investments with prudent cash management. Our focus for Q3 will be revitalizing SMB growth and optimizing sales efficiency.<br/><br/>Thank you for your continued trust.<br/><br/>Sincerely,<br/>CFO, AcmeCorp | Q2 Financial Report for AcmeCorp Investors\</output><br/><br/>Revenue Growth:<br/>- Q2 revenue: \$15.2M (22% YoY ↑)<br/>- Enterprise clients: 30% ↑<br/>- SMB segment: 5% ↓<br/>  Action: Targeted Q3 marketing<br/><br/>Profit Margins:<br/>- Gross margin: 72% (3% ↑ from Q1)<br/>  Reason: Infrastructure optimizations<br/>- EBITDA margin: 18% (2% ↓)<br/>  Reason: R&D investment in AI features<br/><br/>Cash Flow:<br/>- Operating cash flow: \$4.1M (strong)<br/>- Cash reserves: \$28M (15-month runway)<br/>- Customer acquisition cost: 20% ↑<br/>  Action: Optimize sales strategies<br/><br/>Outlook:<br/>- Core financials: Robust<br/>- Q3 focus: Revitalize SMB, optimize sales<br/><br/>Management remains committed to balancing growth investments with financial discipline. |
  
</section>
  <section title="Example: Legal contract analysis">

    Without XML tags, Claude's analysis is disorganized and misses key points. With tags, it provides a structured, thorough analysis that a legal team can act on.

    | Role | No XML Tags | With XML Tags |
    | ---- | ----------- | ------------- |
    | User | Analyze this software licensing agreement for potential risks and liabilities: \{\{CONTRACT\}\}. Focus on indemnification, limitation of liability, and IP ownership clauses. Also, note any unusual or concerning terms. Here's our standard contract for reference: \{\{STANDARD_CONTRACT\}\}. Give a summary of findings and recommendations for our legal team. | Analyze this software licensing agreement for legal risks and liabilities.<br/><br/>We're a multinational enterprise considering this agreement for our core data infrastructure.<br/><br/>\<agreement><br/>\{\{CONTRACT\}\}\</agreement><br/><br/>This is our standard contract for reference:<br/>\<standard_contract>\{\{STANDARD_CONTRACT\}\}\</standard_contract><br/><br/>\<instructions><br/>1. Analyze these clauses:<br/>   - Indemnification<br/>   - Limitation of liability<br/>   - IP ownership<br/><br/>2. Note unusual or concerning terms.<br/><br/>3. Compare to our standard contract.<br/><br/>4. Summarize findings in \<findings> tags.<br/><br/>5. List actionable recommendations in \<recommendations> tags.\</instructions> |
    | Assistant | The provided software licensing agreement presents several concerning aspects. The indemnification clause is overly broad, potentially exposing us to significant liabilities. The limitation of liability section caps damages at a mere \$500, which is inadequate for our enterprise-level usage. Regarding IP, the agreement grants the vendor joint ownership of any modifications or integrations we create.<br/><br/>In summary, this agreement is not in our best interest. It exposes us to undue risk, limits our recourse in case of failures, and compromises our intellectual property rights. I recommend renegotiating these terms or seeking alternative vendors. | \<findings><br/>1. Indemnification (Clause 8):<br/>   - Issue: Overly broad. We indemnify vendor against "any and all claims" arising from our use.<br/>   - Risk: Could hold us liable even for vendor's negligence or product defects.<br/>   - Deviation: Our standard limits indemnity to claims arising from our violation of agreement.<br/><br/>2. Limitation of Liability (Clause 9):<br/>   - Issue: Caps all damages at \$500, including direct damages.<br/>   - Risk: Grossly inadequate for enterprise use. A critical failure could cost millions.<br/>   - Deviation: Our standard allows for direct damages up to 12 months of fees paid.<br/><br/>3. IP Ownership (Clause 12):<br/>   - Issue: Grants vendor joint ownership of our modifications/integrations.<br/>   - Risk: Vendor could use or sell our proprietary algorithms or data insights.<br/>   - Deviation: Our standard retains full ownership of our work.<br/><br/>4. Unusual Terms:<br/>   - Clause 5.3: Vendor can use our usage data for "any purpose."<br/>   - Clause 7.2: Vendor can terminate for "convenience" with only 7 days' notice.<br/>   - Clause 11: No warranties of any kind, even for basic merchantability.<br/>\</findings><br/><br/>\<recommendations><br/>1. Reject this agreement. Risks far outweigh benefits for an enterprise.<br/>2. Counter-propose:<br/>   - Indemnification: Limit to claims arising from our violation of agreement.<br/>   - Liability: Cap at 12 months' fees for direct damages; negotiate for indirect.<br/>   - IP: Full ownership of our modifications/integrations.<br/>   - Data Use: Restrict to service improvement only.<br/>   - Termination: Minimum 90 days' notice; only for cause.<br/>   - Warranties: Demand basic merchantability and fitness for purpose.<br/>3. If vendor refuses, explore alternative providers or in-house solutions.<br/>4. Engage legal counsel for contract negotiation given high stakes.<br/>\</recommendations> |
  
</section>

***

<CardGroup cols={3}>
  <Card title="Prompt library" icon="link" href="/docs/en/resources/prompt-library/library">
    Get inspired by a curated selection of prompts for various tasks and use cases.
  </Card>
  <Card title="GitHub prompting tutorial" icon="link" href="https://github.com/anthropics/prompt-eng-interactive-tutorial">
    An example-filled tutorial that covers the prompt engineering concepts found in our docs.
  </Card>
  <Card title="Google Sheets prompting tutorial" icon="link" href="https://docs.google.com/spreadsheets/d/19jzLgRruG9kjUQNKtCg1ZjdD6l6weA6qRXG5zLIAhC8">
    A lighter weight version of our prompt engineering tutorial via an interactive spreadsheet.
  </Card>
</CardGroup>

# Be clear, direct, and detailed

---

<Note>
While these tips apply broadly to all Claude models, you can find prompting tips specific to extended thinking models [here](/docs/en/build-with-claude/prompt-engineering/extended-thinking-tips).
</Note>

When interacting with Claude, think of it as a brilliant but very new employee (with amnesia) who needs explicit instructions. Like any new employee, Claude does not have context on your norms, styles, guidelines, or preferred ways of working.
The more precisely you explain what you want, the better Claude's response will be.

<Tip>**The golden rule of clear prompting**<br/>Show your prompt to a colleague, ideally someone who has minimal context on the task, and ask them to follow the instructions. If they're confused, Claude will likely be too.</Tip>

## How to be clear, contextual, and specific

- **Give Claude contextual information:** Just like you might be able to better perform on a task if you knew more context, Claude will perform better if it has more contextual information. Some examples of contextual information:
    - What the task results will be used for
    - What audience the output is meant for
    - What workflow the task is a part of, and where this task belongs in that workflow
    - The end goal of the task, or what a successful task completion looks like
- **Be specific about what you want Claude to do:** For example, if you want Claude to output only code and nothing else, say so.
- **Provide instructions as sequential steps:** Use numbered lists or bullet points to better ensure that Claude carries out the task the exact way you want it to.

### Examples

    <section title="Example: Anonymizing customer feedback">

    Notice that Claude still makes mistakes in the unclear prompting example, such as leaving in a customer's name.

    | Role | Unclear Prompt | Clear Prompt |
    | --- | --- | --- |
    | User | Please remove all personally identifiable information from these customer feedback messages: \{\{FEEDBACK_DATA\}\} | Your task is to anonymize customer feedback for our quarterly review.<br/><br/>Instructions:<br/>1. Replace all customer names with "CUSTOMER_[ID]" (e.g., "Jane Doe" → "CUSTOMER_001").<br/>2. Replace email addresses with "EMAIL_[ID]@example.com".<br/>3. Redact phone numbers as "PHONE_[ID]".<br/>4. If a message mentions a specific product (e.g., "AcmeCloud"), leave it intact.<br/>5. If no PII is found, copy the message verbatim.<br/>6. Output only the processed messages, separated by "---".<br/><br/>Data to process: \{\{FEEDBACK_DATA\}\} |
    | Assistant (Claude's response) | Here are the anonymized customer feedback messages:<br/>1. I've been using your software for years, and it's been great. But lately, AcmeCloud has been crashing a lot. Fix it!<br/>2. XXX, your customer support rep, was incredibly helpful. He guided me through the whole process. My email is XXX if you want to send a survey.<br/>3. I'm John Smith, and I'm not happy. I've been on hold for 2 hours trying to reach someone at XXX. This is unacceptable! | CUSTOMER_001: I've been using your software for years, and it's been great. But lately, AcmeCloud has been crashing a lot. Fix it!<br/>---<br/>CUSTOMER_002: CUSTOMER_SERVICE_001, your customer support rep, was incredibly helpful. He guided me through the whole process. My email is EMAIL_002@example.com if you want to send a survey.<br/>---<br/>CUSTOMER_003: I'm CUSTOMER_003, and I'm not happy. I've been on hold for 2 hours trying to reach someone at PHONE_001. This is unacceptable! |
    
</section>
    <section title="Example: Crafting a marketing email campaign">

    Notice that Claude makes up details to fill in the gaps where it lacks context with the vague prompt.

    | Role | Vague Prompt | Specific Prompt |
    | --- | --- | --- |
    | User | Write a marketing email for our new AcmeCloud features. | Your task is to craft a targeted marketing email for our Q3 AcmeCloud feature release.<br/><br/>Instructions:<br/>1. Write for this target audience: Mid-size tech companies (100-500 employees) upgrading from on-prem to cloud.<br/>2. Highlight 3 key new features: advanced data encryption, cross-platform sync, and real-time collaboration.<br/>3. Tone: Professional yet approachable. Emphasize security, efficiency, and teamwork.<br/>4. Include a clear CTA: Free 30-day trial with priority onboarding.<br/>5. Subject line: Under 50 chars, mention "security" and "collaboration".<br/>6. Personalization: Use \{\{COMPANY_NAME\}\} and \{\{CONTACT_NAME\}\} variables.<br/><br/>Structure:<br/>1. Subject line<br/>2. Email body (150-200 words)<br/>3. CTA button text |
    | Assistant (Claude's response) | Here's a draft marketing email for our new features:<br/><br/>Subject: Boost Your Business with AcmeCloud's Latest Features<br/><br/>Dear Valued Customer,<br/><br/>We're excited to introduce three powerful features to AcmeCloud that will revolutionize your workflow:<br/><br/>1. Real-Time Collaboration: Work on documents simultaneously with your team. No more version control issues!<br/>2. AI-Powered Insights: Make data-driven decisions with AI that analyzes trends and automates tasks.<br/>3. Advanced Security Suite: End-to-end encryption, multi-factor auth, and threat detection keep your data safe.<br/><br/>Limited Offer: Upgrade now for a 20% first-year discount. Plus, refer a friend for an extra 10% off!<br/><br/>Best,<br/>The AcmeCloud Team | Subject line: AcmeCloud: Enterprise security meets real-time teamwork<br/><br/>Email body:<br/>Dear \{\{CONTACT_NAME\}\},<br/><br/>At \{\{COMPANY_NAME\}\}, you're scaling fast and eyeing the cloud. But with growth comes the challenge of keeping data secure while fostering collaboration. That's where AcmeCloud's Q3 release comes in, tailor-made for tech innovators like you.<br/><br/>1. Fort Knox for Your Files: Military-grade encryption now safeguards your data, both in motion and at rest. Your intellectual property stays yours, period.<br/>2. Sync Without Borders: Windows, Mac, or Linux—AcmeCloud speaks all languages. Unified version control means no more "final_v2_REALLY_FINAL.doc".<br/>3. Collaborate at Light Speed: Ditch the attachment ping-pong. Now your devs, designers, and data scientists co-create in real-time, slashing time-to-market.<br/><br/>Don't just take our word for it. Experience the AcmeCloud difference with our 30-day trial. And because we know time is your most precious asset, we're throwing in priority onboarding.<br/><br/>Elevate Your Team Now - Free 30-Day Trial |
    
</section>
    <section title="Example: Incident response">

    Notice that Claude outputs superfluous text and different formating with the vague prompt.
    | Role | Vague Prompt | Detailed Prompt |
    | --- | --- | --- |
    | User | Analyze this AcmeCloud outage report and summarize the key points.<br/><br/>\{\{REPORT\}\} | Analyze this AcmeCloud outage report. Skip the preamble. Keep your response terse and write only the bare bones necessary information. List only:<br/>1) Cause<br/>2) Duration<br/>3) Impacted services<br/>4) Number of affected users<br/>5) Estimated revenue loss. <br/><br/>Here's the report: \{\{REPORT\}\}|
    | Assistant (Claude's response) | Here's a summary of the key points from the AcmeCloud outage report:<br/><br/>On May 15th, a misconfigured load balancer update caused significant traffic routing issues, resulting in a service outage from 09:15 to 13:52 UTC. The 4-hour 37-minute disruption impacted our core file syncing service and admin dashboard, rendering them inaccessible. Additionally, the mobile app experienced partial functionality loss. Approximately 68% of our user base, totaling 1.3 million users, were affected. Based on our Service Level Agreements (SLAs) and average revenue per user, we estimate a financial impact of $420,000 in service credits and potential customer churn. | 1) Cause: Misconfigured load balancer update<br/>2) Duration: 4h 37m (09:15-13:52 UTC, May 15)<br/>3) Impacted: Core sync, admin dashboard (down); mobile app (partial)<br/>4) Affected users: 1.3M (68% of base)<br/>5) Est. revenue loss: $420,000 |
    
</section>

***

<CardGroup cols={3}>
  <Card title="Prompt library" icon="link" href="/docs/en/resources/prompt-library/library">
    Get inspired by a curated selection of prompts for various tasks and use cases.
  </Card>
  <Card title="GitHub prompting tutorial" icon="link" href="https://github.com/anthropics/prompt-eng-interactive-tutorial">
    An example-filled tutorial that covers the prompt engineering concepts found in our docs.
  </Card>
  <Card title="Google Sheets prompting tutorial" icon="link" href="https://docs.google.com/spreadsheets/d/19jzLgRruG9kjUQNKtCg1ZjdD6l6weA6qRXG5zLIAhC8">
    A lighter weight version of our prompt engineering tutorial via an interactive spreadsheet.
  </Card>
</CardGroup>

# Use examples (multishot prompting) to guide Claude's behavior

---

<Note>
While these tips apply broadly to all Claude models, you can find prompting tips specific to extended thinking models [here](/docs/en/build-with-claude/prompt-engineering/extended-thinking-tips).
</Note>

Examples are your secret weapon shortcut for getting Claude to generate exactly what you need. By providing a few well-crafted examples in your prompt, you can dramatically improve the accuracy, consistency, and quality of Claude's outputs.
This technique, known as few-shot or multishot prompting, is particularly effective for tasks that require structured outputs or adherence to specific formats.

<Tip>**Power up your prompts**: Include 3-5 diverse, relevant examples to show Claude exactly what you want. More examples = better performance, especially for complex tasks.</Tip>

## Why use examples?

- **Accuracy**: Examples reduce misinterpretation of instructions.
- **Consistency**: Examples enforce uniform structure and style.
- **Performance**: Well-chosen examples boost Claude's ability to handle complex tasks.

## Crafting effective examples

For maximum effectiveness, make sure that your examples are:
- **Relevant**: Your examples mirror your actual use case.
- **Diverse**: Your examples cover edge cases and potential challenges, and vary enough that Claude doesn't inadvertently pick up on unintended patterns.
- **Clear**: Your examples are wrapped in `<example>` tags (if multiple, nested within `<examples>` tags) for structure.

<Tip>Ask Claude to evaluate your examples for relevance, diversity, or clarity. Or have Claude generate more examples based on your initial set.</Tip>
<section title="Example: Analyzing customer feedback">

    Notice that in the "no examples" version, Claude does not list multiple options for each category, despite its written analysis indicating that there are multiple categories for certain feedback. It also includes a long explanation when we may not want it to.

    | Role | No Examples | With Examples |
    | --- | --- | --- |
    | User | Analyze this customer feedback and categorize the issues. Use these categories: UI/UX, Performance, Feature Request, Integration, Pricing, and Other. Also rate the sentiment (Positive/Neutral/Negative) and priority (High/Medium/Low).<br/><br/>Here is the feedback: \{\{FEEDBACK\}\} | Our CS team is overwhelmed with unstructured feedback. Your task is to analyze feedback and categorize issues for our product and engineering teams. Use these categories: UI/UX, Performance, Feature Request, Integration, Pricing, and Other. Also rate the sentiment (Positive/Neutral/Negative) and priority (High/Medium/Low). Here is an example:<br/><br/>\<example><br/>Input: The new dashboard is a mess! It takes forever to load, and I can't find the export button. Fix this ASAP!<br/>Category: UI/UX, Performance<br/>Sentiment: Negative<br/>Priority: High\</example><br/><br/>Now, analyze this feedback: \{\{FEEDBACK\}\} |
    | Assistant (Claude's response) | Here's the analysis of the customer feedback:<br/><br/>Issue: UI/UX<br/>Sentiment: Negative<br/>Priority: High<br/>The customer is frustrated with the new dashboard design, which they find cluttered and slow to load. They specifically call out the missing "export" button, which is likely a critical feature. This issue needs to be addressed as a high priority.<br/><br/>Issue: Integration<br/>Sentiment: Positive<br/>Priority: Medium<br/>The customer is pleased with the existing Salesforce integration but would like to see support for Hubspot as well. This is a feature request that could be considered for a future product update.<br/><br/>Issue: Pricing<br/>Sentiment: Negative<br/>Priority: High<br/>The customer finds the pricing to be unreasonable, especially for the basic features. They are threatening to switch to a competitor, so this is a high-priority issue that needs to be reviewed.<br/><br/>Issue: Performance<br/>Sentiment Negative<br/>Priority: High<br/>The customer is experiencing critical issues with the mobile app, where large file uploads consistently result in crashes. This is a significant problem that impacts the customer's ability to use the product effectively and should be addressed as a high priority.<br/><br/>Issue: UI/UX<br/>Sentiment: Positive<br/>Priority: Low<br/>The customer is overall satisfied with the product, specifically calling out the intuitive UI and excellent customer support. This is a positive piece of feedback that does not require any immediate action. | Here's the analysis of the customer feedback:<br/><br/>1. The new dashboard is a mess! It takes forever to load, and I can't find the export button. Fix this ASAP!<br/>Category: UI/UX, Performance<br/>Sentiment: Negative<br/>Priority: High<br/><br/>2. Love the Salesforce integration! But it'd be great if you could add Hubspot too.<br/>Category: Integration, Feature Request<br/>Sentiment: Positive<br/>Priority: Medium<br/><br/>3. Your pricing is ridiculous! $99/mo for basic features? I'm switching to Competitor X.<br/>Category: Pricing<br/>Sentiment: Negative<br/>Priority: High<br/><br/>4. The mobile app keeps crashing when I try to upload large files (>50MB). This is critical for our field agents.<br/>Category: Performance<br/>Sentiment: Negative<br/>Priority: High<br/><br/>5. Overall, I'm happy with the product. The UI is intuitive, and the customer support is top-notch. Keep it up!<br/>Category: UI/UX, Other (Customer Support)<br/>Sentiment: Positive<br/>Priority: Low |

</section>

***

<CardGroup cols={3}>
  <Card title="Prompt library" icon="link" href="/docs/en/resources/prompt-library/library">
    Get inspired by a curated selection of prompts for various tasks and use cases.
  </Card>
  <Card title="GitHub prompting tutorial" icon="link" href="https://github.com/anthropics/prompt-eng-interactive-tutorial">
    An example-filled tutorial that covers the prompt engineering concepts found in our docs.
  </Card>
  <Card title="Google Sheets prompting tutorial" icon="link" href="https://docs.google.com/spreadsheets/d/19jzLgRruG9kjUQNKtCg1ZjdD6l6weA6qRXG5zLIAhC8">
    A lighter weight version of our prompt engineering tutorial via an interactive spreadsheet.
  </Card>
</CardGroup>

# Giving Claude a role with a system prompt

---

<Note>
While these tips apply broadly to all Claude models, you can find prompting tips specific to extended thinking models [here](/docs/en/build-with-claude/prompt-engineering/extended-thinking-tips).
</Note>

When using Claude, you can dramatically improve its performance by using the `system` parameter to give it a role. This technique, known as role prompting, is the most powerful way to use system prompts with Claude.

The right role can turn Claude from a general assistant into your virtual domain expert!

<Tip>**System prompt tips**: Use the `system` parameter to set Claude's role. Put everything else, like task-specific instructions, in the `user` turn instead.</Tip>

## Why use role prompting?

- **Enhanced accuracy:** In complex scenarios like legal analysis or financial modeling, role prompting can significantly boost Claude's performance.
- **Tailored tone:** Whether you need a CFO's brevity or a copywriter's flair, role prompting adjusts Claude's communication style.
- **Improved focus:** By setting the role context, Claude stays more within the bounds of your task's specific requirements.

***

## How to give Claude a role

Use the `system` parameter in the [Messages API](/docs/en/api/messages) to set Claude's role:

```python
import anthropic

client = anthropic.Anthropic()

response = client.messages.create(
    model="claude-sonnet-4-5-20250929",
    max_tokens=2048,
    system="You are a seasoned data scientist at a Fortune 500 company.", # <-- role prompt
    messages=[
        {"role": "user", "content": "Analyze this dataset for anomalies: <dataset>{{DATASET}}</dataset>"}
    ]
)

print(response.content)
```

<Tip>**Role prompting tip**: Experiment with roles! A `data scientist` might see different insights than a `marketing strategist` for the same data. A `data scientist specializing in customer insight analysis for Fortune 500 companies` might yield different results still!</Tip>

***

## Examples

### Example 1: Legal contract analysis
Without a role, Claude might miss critical issues:

<section title="Legal contract analysis without role prompting">

| Role | Content |
| ---- | ------- |
| User | Analyze this software licensing agreement for potential risks:<br/>\<contract><br/>\{\{CONTRACT\}\}<br/>\</contract><br/><br/>Focus on indemnification, liability, and IP ownership. |
| Assistant | Here's a summary of the key points in the software licensing agreement:<br/><br/>1. Indemnification (Section 8):<br/>   - We indemnify the vendor against claims arising from our use.<br/><br/>2. Limitation of Liability (Section 9):<br/>   - Damages capped at \$500.<br/><br/>3. IP Ownership (Section 12):<br/>   - We retain ownership of our modifications.<br/><br/>Overall, the agreement seems standard. The indemnification and liability clauses are typical, and we maintain our IP rights. |

</section>

With a role, Claude catches critical issues that could cost millions:

<section title="Legal contract analysis with role prompting">

| Role | Content |
| ---- | ------- |
| User | You are the General Counsel of a Fortune 500 tech company. We're considering this software licensing agreement for our core data infrastructure:<br/>\<contract><br/>\{\{CONTRACT\}\}<br/>\</contract><br/><br/>Analyze it for potential risks, focusing on indemnification, liability, and IP ownership. Give your professional opinion. |
| Assistant | I've reviewed the software licensing agreement, and I have serious concerns that could expose our company to significant risks:<br/><br/>1. Indemnification (Section 8):<br/>   - Critical Issue: We indemnify the vendor against "any and all claims" arising from our use.<br/>   - Risk: This could hold us liable even for the vendor's negligence or product defects.<br/>   - Recommendation: Reject. Limit our indemnity to claims arising from our violation of the agreement.<br/><br/>2. Limitation of Liability (Section 9):<br/>   - Critical Issue: Damages capped at \$500, including direct damages.<br/>   - Risk: Grossly inadequate. A critical failure in our data infrastructure could cost us millions in lost revenue and reputational damage.<br/>   - Recommendation: Reject. Negotiate for cap at 12 months of fees for direct damages, and carve-outs for data breaches.<br/><br/>3. IP Ownership (Section 12):<br/>   - Critical Issue: Vendor gains joint ownership of our modifications and integrations.<br/>   - Risk: They could use or sell our proprietary algorithms or data insights to competitors.<br/>   - Recommendation: Reject. We must retain full ownership of our work.<br/><br/>Professional Opinion: Do not sign this agreement. It is grossly unfavorable and exposes us to unacceptable levels of risk. If the vendor refuses to renegotiate these terms, I strongly advise exploring alternative providers or accelerating our in-house solution. The potential costs of proceeding with this agreement far outweigh any short-term gains. |

</section>

### Example 2: Financial analysis
Without a role, Claude's analysis lacks depth:

<section title="Financial analysis without role prompting">

| Role | Content |
| ---- | ------- |
| User | Analyze this dataset of our Q2 financials:<br/>\<data><br/>\{\{FINANCIALS\}\}<br/>\</data><br/><br/>Highlight key trends and recommend actions. |
| Assistant | Here's a summary of your Q2 financials:<br/><br/>1. Revenue: \$15.2M, up 22% YoY. Enterprise client base grew 30%.<br/>2. Gross Margin: 72%, up 3% from Q1.<br/>3. EBITDA Margin: 18%, down 2% due to R&D investments.<br/>4. Cash Flow: \$4.1M operating, \$28M in reserves.<br/><br/>Overall, financials look strong with revenue growth and healthy margins. Increased R&D spending is impacting profitability but could pay off long-term. Maintain current course. |

</section>

With a role, Claude delivers actionable insights:

<section title="Financial analysis with role prompting">

| Role | Content |
| ---- | ------- |
| User | You are the CFO of a high-growth B2B SaaS company. We're in a board meeting discussing our Q2 financials:<br/>\<data><br/>\{\{FINANCIALS\}\}<br/>\</data><br/><br/>Analyze key trends, flag concerns, and recommend strategic actions. Our investors want aggressive growth but are wary of our burn rate. |
| Assistant | Board members, here's my analysis of our Q2 financials:<br/><br/>1. Revenue (\$15.2M, +22% YoY):<br/>   - Insight: Enterprise growth (+30%) is outpacing overall growth.<br/>   - Flag: SMB segment declined 5%.<br/>   - Action: Reallocate 20% of SMB marketing budget to enterprise sales. Task product to simplify SMB onboarding.<br/><br/>2. Margins (Gross: 72%, +3% QoQ; EBITDA: 18%, -2% QoQ):<br/>   - Insight: Infrastructure optimizations boosted gross margins.<br/>   - Flag: R&D spend on AI features dented EBITDA.<br/>   - Action: No change. Our AI roadmap is critical for enterprise stickiness.<br/><br/>3. Cash (\$4.1M OCF, \$28M reserves):<br/>   - Insight: 15-month runway at current burn.<br/>   - Flag: CAC up 20%, eroding LTV/CAC.<br/>   - Action: Freeze non-essential hires. Implement sales funnel analytics to cut CAC by 15% in Q3.<br/><br/>Strategic Stance: We're threading the needle between growth and burn. Enterprise focus is our growth engine—invest there. But watch SMB churn; it could bleed into enterprise. Our AI bet is sound, but we must convert it to ARR by Q4, or we cut R&D by 30%.<br/><br/>In sum: Double down on enterprise, streamline SMB, optimize sales, and monetize AI. Questions? |

</section>

---

<CardGroup cols={3}>
  <Card title="Prompt library" icon="link" href="/docs/en/resources/prompt-library/library">
    Get inspired by a curated selection of prompts for various tasks and use cases.
  </Card>
  <Card title="GitHub prompting tutorial" icon="link" href="https://github.com/anthropics/prompt-eng-interactive-tutorial">
    An example-filled tutorial that covers the prompt engineering concepts found in our docs.
  </Card>
  <Card title="Google Sheets prompting tutorial" icon="link" href="https://docs.google.com/spreadsheets/d/19jzLgRruG9kjUQNKtCg1ZjdD6l6weA6qRXG5zLIAhC8">
    A lighter weight version of our prompt engineering tutorial via an interactive spreadsheet.
  </Card>
</CardGroup>

# Long context prompting tips

---

<Note>
While these tips apply broadly to all Claude models, you can find prompting tips specific to extended thinking models [here](/docs/en/build-with-claude/prompt-engineering/extended-thinking-tips).
</Note>

Claude's extended context window (200K tokens for Claude 3 models) enables handling complex, data-rich tasks. This guide will help you leverage this power effectively.

## Essential tips for long context prompts

- **Put longform data at the top**: Place your long documents and inputs (~20K+ tokens) near the top of your prompt, above your query, instructions, and examples. This can significantly improve Claude's performance across all models.

    <Note>Queries at the end can improve response quality by up to 30% in tests, especially with complex, multi-document inputs.</Note>

- **Structure document content and metadata with XML tags**: When using multiple documents, wrap each document in `<document>` tags with `<document_content>` and `<source>` (and other metadata) subtags for clarity.

    <section title="Example multi-document structure">

    ```xml
    <documents>
      <document index="1">
        <source>annual_report_2023.pdf</source>
        <document_content>
          {{ANNUAL_REPORT}}
        </document_content>
      </document>
      <document index="2">
        <source>competitor_analysis_q2.xlsx</source>
        <document_content>
          {{COMPETITOR_ANALYSIS}}
        </document_content>
      </document>
    </documents>

    Analyze the annual report and competitor analysis. Identify strategic advantages and recommend Q3 focus areas.
    ```
    
</section>

- **Ground responses in quotes**: For long document tasks, ask Claude to quote relevant parts of the documents first before carrying out its task. This helps Claude cut through the "noise" of the rest of the document's contents.

    <section title="Example quote extraction">

    ```xml
    You are an AI physician's assistant. Your task is to help doctors diagnose possible patient illnesses.

    <documents>
      <document index="1">
        <source>patient_symptoms.txt</source>
        <document_content>
          {{PATIENT_SYMPTOMS}}
        </document_content>
      </document>
      <document index="2">
        <source>patient_records.txt</source>
        <document_content>
          {{PATIENT_RECORDS}}
        </document_content>
      </document>
      <document index="3">
        <source>patient01_appt_history.txt</source>
        <document_content>
          {{PATIENT01_APPOINTMENT_HISTORY}}
        </document_content>
      </document>
    </documents>

    Find quotes from the patient records and appointment history that are relevant to diagnosing the patient's reported symptoms. Place these in <quotes> tags. Then, based on these quotes, list all information that would help the doctor diagnose the patient's symptoms. Place your diagnostic information in <info> tags.
    ```
    
</section>

***

<CardGroup cols={3}>
  <Card title="Prompt library" icon="link" href="/docs/en/resources/prompt-library/library">
    Get inspired by a curated selection of prompts for various tasks and use cases.
  </Card>
  <Card title="GitHub prompting tutorial" icon="link" href="https://github.com/anthropics/prompt-eng-interactive-tutorial">
    An example-filled tutorial that covers the prompt engineering concepts found in our docs.
  </Card>
  <Card title="Google Sheets prompting tutorial" icon="link" href="https://docs.google.com/spreadsheets/d/19jzLgRruG9kjUQNKtCg1ZjdD6l6weA6qRXG5zLIAhC8">
    A lighter weight version of our prompt engineering tutorial via an interactive spreadsheet.
  </Card>
</CardGroup>

# Let Claude think (chain of thought prompting) to increase performance

---

<Note>
While these tips apply broadly to all Claude models, you can find prompting tips specific to extended thinking models [here](/docs/en/build-with-claude/prompt-engineering/extended-thinking-tips).
</Note>

When faced with complex tasks like research, analysis, or problem-solving, giving Claude space to think can dramatically improve its performance. This technique, known as chain of thought (CoT) prompting, encourages Claude to break down problems step-by-step, leading to more accurate and nuanced outputs.

## Before implementing CoT

### Why let Claude think?
- **Accuracy:** Stepping through problems reduces errors, especially in math, logic, analysis, or generally complex tasks.
- **Coherence:** Structured thinking leads to more cohesive, well-organized responses.
- **Debugging:** Seeing Claude's thought process helps you pinpoint where prompts may be unclear.

### Why not let Claude think?
- Increased output length may impact latency.
- Not all tasks require in-depth thinking. Use CoT judiciously to ensure the right balance of performance and latency.

<Tip>Use CoT for tasks that a human would need to think through, like complex math, multi-step analysis, writing complex documents, or decisions with many factors.</Tip>

***

## How to prompt for thinking

The chain of thought techniques below are **ordered from least to most complex**. Less complex methods take up less space in the context window, but are also generally less powerful.

<Tip>**CoT tip**: Always have Claude output its thinking. Without outputting its thought process, no thinking occurs!</Tip>

- **Basic prompt**: Include "Think step-by-step" in your prompt.
    - Lacks guidance on *how* to think (which is especially not ideal if a task is very specific to your app, use case, or organization)
    <section title="Example: Writing donor emails (basic CoT)">

        | Role | Content |
        | ---- | ------- |
        | User | Draft personalized emails to donors asking for contributions to this year's Care for Kids program.<br/><br/>Program information:<br/>\\{\{PROGRAM_DETAILS}}<br/>\</program><br/><br/>Donor information:<br/>\<donor>\{\{DONOR_DETAILS}}<br/>\</donor><br/><br/>Think step-by-step before you write the email. |
    
</section>
- **Guided prompt**: Outline specific steps for Claude to follow in its thinking process.
    - Lacks structuring to make it easy to strip out and separate the answer from the thinking.
    <section title="Example: Writing donor emails (guided CoT)">

        | Role | Content |
        | ---- | ------- |
        | User | Draft personalized emails to donors asking for contributions to this year's Care for Kids program.<br/><br/>Program information:<br/>\\{\{PROGRAM_DETAILS}}<br/>\</program><br/><br/>Donor information:<br/>\<donor>\{\{DONOR_DETAILS}}<br/>\</donor><br/><br/>Think before you write the email. First, think through what messaging might appeal to this donor given their donation history and which campaigns they've supported in the past. Then, think through what aspects of the Care for Kids program would appeal to them, given their history. Finally, write the personalized donor email using your analysis. |
    
</section>
- **Structured prompt**: Use XML tags like `<thinking>` and `<answer>` to separate reasoning from the final answer.
     <section title="Example: Writing donor emails (structured guided CoT)">

        | Role | Content |
        | ---- | ------- |
        | User | Draft personalized emails to donors asking for contributions to this year's Care for Kids program.<br/><br/>Program information:<br/>\\{\{PROGRAM_DETAILS}}<br/>\</program><br/><br/>Donor information:<br/>\<donor>\{\{DONOR_DETAILS}}<br/>\</donor><br/><br/>Think before you write the email in \<thinking> tags. First, think through what messaging might appeal to this donor given their donation history and which campaigns they've supported in the past. Then, think through what aspects of the Care for Kids program would appeal to them, given their history. Finally, write the personalized donor email in \<email> tags, using your analysis. |
    
</section>
    
### Examples

  <section title="Example: Financial analysis without thinking">

    Without step-by-step thinking, Claude gives a recommendation that seems reasonable but lacks depth. It doesn't quantify the potential outcomes or consider historical market performance, which are crucial for making an informed decision.
    | Role | Content |
    | ---- | ------- |
    | User | You're a financial advisor. A client wants to invest \$10,000. They can choose between two options: A) A stock that historically returns 12% annually but is volatile, or B) A bond that guarantees 6% annually. The client needs the money in 5 years for a down payment on a house. Which option do you recommend? |
    | Assistant | Based on the information provided, I would recommend option B, the bond that guarantees a 6% annual return. Here's why:<br/><br/>1. Certainty: The bond offers a guaranteed 6% annual return, which provides certainty in financial planning. This is crucial when the client has a specific financial goal (down payment) with a fixed timeline (5 years).<br/>2. Risk aversion: Since the client needs this money for an important life event (buying a house), they likely have a low risk tolerance. The volatility of the stock market could jeopardize their plans if there's a downturn close to when they need the funds.<br/>3. Time horizon: With only 5 years, there's less time to recover from potential stock market downturns. Longer investment horizons (10+ years) are generally better suited for weathering stock market volatility.<br/><br/>While the stock's historical 12% return is attractive, past performance doesn't guarantee future results. The guaranteed 6% from the bond ensures the client will have the funds they need when it's time to make the down payment. |
  
</section>
  <section title="Example: Financial analysis with thinking">

    With step-by-step thinking, the advisor provides a much richer analysis. It calculates exact figures for both scenarios, considers historical market volatility, and deeply analyzes the client's risk tolerance. This thorough reasoning leads to a more confident and justifiable recommendation.
    | Role | Content |
    | ---- | ------- |
    | User | You're a financial advisor. A client wants to invest \$10,000. They can choose between two options: A) A stock that historically returns 12% annually but is volatile, or B) A bond that guarantees 6% annually. The client needs the money in 5 years for a down payment on a house. Which option do you recommend? Think step-by-step. |
    | Assistant | To determine the best investment option for our client, I'll consider several factors step-by-step:<br/><br/>\<thinking><br/>1. Understand the client's goal and timeline:<br/>   - Goal: Down payment for a house<br/>   - Timeline: 5 years<br/>   - Implication: This is a short-term, high-priority financial goal. The client likely cannot afford significant risk or volatility.<br/><br/>2. Analyze Option A (Stock):<br/>   - Pro: Higher historical return (12% annually)<br/>   - Con: Volatile (implying potential for significant gains or losses)<br/>   - Calculate potential 5-year return:<br/>     - Best case (12% annually): \$10,000 * (1.12)^5 ≈ \$17,623.42<br/>     - Worst case (market crash): Could lose a substantial portion, e.g., 50% crash = \$5,000<br/><br/>3. Analyze Option B (Bond):<br/>   - Pro: Guaranteed return (6% annually)<br/>   - Con: Lower return compared to historical stock performance<br/>   - Calculate 5-year return:<br/>     - Guaranteed: \$10,000 * (1.06)^5 ≈ \$13,382.25<br/><br/>4. Consider risk tolerance:<br/>   - Goal is a house down payment (essential, not discretionary)<br/>   - Short timeline (5 years) limits ability to recover from market downturns<br/>   - Conclusion: Client likely has low risk tolerance<br/><br/>5. Historical perspective:<br/>   - Stock's 12% is historical, not guaranteed<br/>   - In 5-year periods, stock market can vary wildly:<br/>     - 2003-2007 (pre-financial crisis): S&P 500 up ~82%<br/>     - 2007-2011 (during crisis): S&P 500 down ~2%<br/>   - Conclusion: Past performance doesn't guarantee future results, especially short-term<br/><br/>6. Final analysis:<br/>   - Option A (Stock): Higher potential return but unacceptable risk of not meeting the down payment goal<br/>   - Option B (Bond): Guaranteed to meet ~80% of best-case stock scenario, 100% certainty of having funds<br/>\</thinking><br/><br/>\<answer><br/>I recommend Option B, the bond with a guaranteed 6% annual return. While the stock's historical 12% return is tempting, the bond ensures you'll have \$13,382.25 in 5 years for your house down payment. Given the importance and short timeline of your goal, the stock's volatility poses an unacceptable risk. The bond provides certainty, which is invaluable for such a crucial financial milestone.<br/>\</answer> |
  
</section>

***

<CardGroup cols={3}>
  <Card title="Prompt library" icon="link" href="/docs/en/resources/prompt-library/library">
    Get inspired by a curated selection of prompts for various tasks and use cases.
  </Card>
  <Card title="GitHub prompting tutorial" icon="link" href="https://github.com/anthropics/prompt-eng-interactive-tutorial">
    An example-filled tutorial that covers the prompt engineering concepts found in our docs.
  </Card>
  <Card title="Google Sheets prompting tutorial" icon="link" href="https://docs.google.com/spreadsheets/d/19jzLgRruG9kjUQNKtCg1ZjdD6l6weA6qRXG5zLIAhC8">
    A lighter weight version of our prompt engineering tutorial via an interactive spreadsheet.
  </Card>
</CardGroup>
