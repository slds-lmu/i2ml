---
title: "Chapter 04.05: Overfitting & Underfitting"
weight: 4005
---
In machine learning, we are interested in a model that captures the true underlying function and still generalizes well to new data.
When the model fails on the first task, we speak of underfitting, and both train and test error will be high.
On the other hand, learning the training data very well at the expense of generalization ability is referred to as overfitting and usually occurs when there is not enough data to tell our hypotheses apart.
We will show you examples of this behavior and how to diagnose overfitting.

<!--more-->

### Lecture video

{{< video id="eNMM1b98kow" >}}

### Lecture slides

{{< pdfjs file="slides-evaluation-overfitting-underfitting.pdf" >}}

### Code demo

**Overfitting**

You can run the code snippets in the demos on your local machine. The corresponding Rmd version of this demo can be found [here](https://github.com/compstat-lmu/lecture_i2ml/blob/master/code-demos/code_demo_overfitting.Rmd). If you want to render the Rmd files to PDF, you need the accompanying [style files](https://github.com/compstat-lmu/lecture_i2ml/tree/master/style). 

{{< pdfjs file="code_demo_overfitting.pdf" >}}