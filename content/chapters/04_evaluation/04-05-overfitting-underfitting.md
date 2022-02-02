---
title: "Chapter 04.05: Overfitting & Underfitting"
weight: 4005
quizdown: true
---
In machine learning, we are interested in a model that captures the true underlying function and still generalizes well to new data.
When the model fails on the first task, we speak of underfitting, and both train and test error will be high.
On the other hand, learning the training data very well at the expense of generalization ability is referred to as overfitting and usually occurs when there is not enough data to tell our hypotheses apart.
We will show you examples of this behavior and how to diagnose overfitting.

<!--more-->

### Lecture video

{{< video id="eNMM1b98kow" >}}

### Lecture slides

{{< pdfjs file="https://github.com/slds-lmu/lecture_i2ml/blob/master/slides-pdf/slides-evaluation-overfitting-underfitting.pdf" >}}

### Code demo

**Overfitting**

You can run the code snippets in the demos on your local machine. The corresponding Rmd version of this demo can be found [here](https://github.com/compstat-lmu/lecture_i2ml/blob/master/code-demos/code_demo_overfitting.Rmd). If you want to render the Rmd files to PDF, you need the accompanying [style files](https://github.com/compstat-lmu/lecture_i2ml/tree/master/style). 

{{< pdfjs file="https://github.com/slds-lmu/lecture_i2ml/tree/master/code-demos-pdf/code_demo_overfitting.pdf" >}}

### Quiz

{{< quizdown >}}

---
shuffle_questions: false
---

## Which statements are true? 

- [x] Overfitting means that the model performs much better on the training data than on the test data.
- [ ] A good test performance is an indicator of overfitting.
- [ ] The linear model is known to overfit very fast.
- [x] Overfitting risk increases with model complexity.
- [x] Constraining the hypothesis space helps the learner to find a good hypothesis.
- [ ] Goodness-of-fit measures like $R^2$, likelihood, AIC, BIC and deviance are all based on the test error.

{{< /quizdown >}}
